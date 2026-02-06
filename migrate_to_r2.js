require('dotenv').config()
const axios = require('axios')
const fs = require('fs-extra')
const path = require('path')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const colors = require('colors')

const API_URL = process.env.API_URL || 'http://localhost:3000'
const EMAIL = process.env.ADMIN_EMAIL
const PASSWORD = process.env.ADMIN_PASSWORD
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, '') : ''
const R2_ENDPOINT = process.env.S3_ENDPOINT
const R2_REGION = process.env.S3_REGION || 'auto'
const R2_BUCKET = process.env.S3_BUCKET
const R2_KEY = process.env.S3_ACCESS_KEY
const R2_SECRET = process.env.S3_SECRET_KEY

// Secondary (Old) Bucket Config
const S3_OLD_BUCKET = process.env.S3_OLD_BUCKET
const S3_OLD_ACCESS_KEY = process.env.S3_OLD_ACCESS_KEY
const S3_OLD_SECRET_KEY = process.env.S3_OLD_SECRET_KEY

if (!EMAIL || !PASSWORD || !PUBLIC_BASE_URL || !R2_ENDPOINT || !R2_BUCKET || !R2_KEY || !R2_SECRET) {
  console.error('❌ Variables de entorno faltantes'.red)
  process.exit(1)
}

// Helpers for clients
function getClient(accessKeyId, secretAccessKey) {
  return new S3Client({
    region: R2_REGION,
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false // Ensure we use virtual-hosted style if needed, though B2 supports both. Backend uses false.
  })
}

// Primary Client (New Bucket)
const primaryClient = getClient(R2_KEY, R2_SECRET)
// Secondary Client (Old Bucket) - Optional
const secondaryClient = (S3_OLD_ACCESS_KEY && S3_OLD_SECRET_KEY) 
  ? getClient(S3_OLD_ACCESS_KEY, S3_OLD_SECRET_KEY) 
  : null

let authToken = null

async function login() {
  const res = await axios.post(`${API_URL}/auth/login`, { email: EMAIL, password: PASSWORD })
  authToken = res.data.accessToken
}

async function getMangas() {
  const res = await axios.get(`${API_URL}/manga`)
  return res.data
}

async function getChaptersBySeries(seriesId) {
  try {
    // OPTIMIZATION: Fetch light list first, then details
    const res = await axios.get(`${API_URL}/chapters/series/${seriesId}`)
    const chapters = res.data
    return await fetchDetailsForChapters(chapters)
  } catch (e) {
    return []
  }
}

async function fetchDetailsForChapters(chapters) {
  if (!chapters || chapters.length === 0) return [];
  
  if (chapters[0].pages && Array.isArray(chapters[0].pages)) {
      return chapters;
  }
  
  console.log('   ℹ️  Fetching chapter details...'.cyan);

  const BATCH_SIZE = 1; // SECUENCIAL
  const results = [];
  
  for (let i = 0; i < chapters.length; i += BATCH_SIZE) {
      const batch = chapters.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (chapter) => {
          if (chapter.pages && Array.isArray(chapter.pages)) return chapter;
          
          let attempts = 0;
          const maxAttempts = 5;

          while (attempts < maxAttempts) {
            try {
                const detail = await axios.get(`${API_URL}/chapters/${chapter._id}`, { timeout: 15000 });
                return detail.data;
            } catch (e) {
                attempts++;
                const isRateLimit = e.response && e.response.status === 429;
                
                if (isRateLimit) {
                    const waitTime = attempts * 5000;
                    console.log(`      ⏳ Rate Limit (429) on Cap ${chapter.number}. Waiting ${waitTime/1000}s...`.yellow);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }

                if (attempts >= maxAttempts) {
                    console.log(`      ⚠️  Failed to fetch details for Cap ${chapter.number}: ${e.message}`.yellow);
                    chapter._verificationFailed = true;
                    return chapter;
                }
                await new Promise(r => setTimeout(r, 1000 * attempts));
            }
          }
      });
      
      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
      await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}

function makeKey(seriesTitle, chapterTitle, index, ext) {
  const safeSeries = seriesTitle.replace(/[<>:"/\\|?*]/g, '').trim()
  const safeChapter = chapterTitle.replace(/[<>:"/\\|?*]/g, '').trim()
  const filename = `${index + 1}${ext}`
  return `${safeSeries}/${safeChapter}/${filename}`
}

async function uploadToR2(buffer, key, contentType) {
  // Strategy: Try Old Bucket (Secondary) first -> Then New Bucket (Primary)
  
  if (secondaryClient && S3_OLD_BUCKET) {
    try {
      const cmd = new PutObjectCommand({
        Bucket: S3_OLD_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'image/jpeg'
      })
      await secondaryClient.send(cmd)
      // Assuming PUBLIC_BASE_URL points to a Worker that handles both buckets transparently
      return `${PUBLIC_BASE_URL}/${key}`
    } catch (e) {
      // If it fails (e.g. bucket full), warn and proceed to primary
      // We could check error code, but for now we assume failover is desired on any error
      // except maybe interruptions. But we have the buffer, so we can retry.
      // console.log(`   ⚠️  Old bucket upload failed: ${e.message}. Trying new bucket...`.yellow)
    }
  }

  // Primary (New) Bucket
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'image/jpeg'
  })
  await primaryClient.send(cmd)
  return `${PUBLIC_BASE_URL}/${key}`
}

async function downloadBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', validateStatus: s => s < 400 })
  const contentType = res.headers['content-type'] || 'image/jpeg'
  return { buffer: res.data, contentType }
}

async function updateChapterPages(chapterId, pages) {
  await axios.put(`${API_URL}/chapters/${chapterId}`, { pages }, { headers: { Authorization: `Bearer ${authToken}` } })
}

async function migrateSeries(series, seriesChapters) {
  console.log(`\n📦 Migrando serie: ${series.title}`.cyan.bold)
  for (const ch of seriesChapters) {
    const title = ch.title || `Capítulo ${ch.number}`
    const oldPages = Array.isArray(ch.pages) ? ch.pages : []
    if (oldPages.length === 0) continue
    console.log(`   ▶ Capítulo ${title} (${oldPages.length} páginas)`.white)
    const newPages = []
    for (let i = 0; i < oldPages.length; i++) {
      const url = oldPages[i]
      const base = url.split('?')[0]
      const ext = path.extname(base) || '.jpg'
      const key = makeKey(series.title, title, i, ext)
      try {
        const { buffer, contentType } = await downloadBuffer(url)
        const uploadedUrl = await uploadToR2(buffer, key, contentType)
        newPages.push(uploadedUrl)
        process.stdout.write(`\r      ${i + 1}/${oldPages.length}`)
      } catch (e) {
        console.log(`\n      ❌ Error migrando página ${i + 1}: ${e.message}`.red)
      }
    }
    console.log('')
    if (newPages.length > 0) {
      await updateChapterPages(ch._id, newPages)
      console.log(`   ✅ Capítulo actualizado en BD`.green)
    } else {
      console.log(`   ⚠️ Sin páginas nuevas, capítulo no actualizado`.yellow)
    }
  }
}

async function main() {
  await login()
  const mangas = await getMangas()
  for (const m of mangas) {
    const seriesChapters = await getChaptersBySeries(m._id)
    if (!Array.isArray(seriesChapters) || seriesChapters.length === 0) continue
    await migrateSeries(m, seriesChapters)
  }
  console.log('\n✨ Migración completa'.rainbow)
}

main().catch(err => {
  console.error('❌ Error de migración', err.message)
  process.exit(1)
})
