
// CONFIGURACIÓN DE LOS BUCKETS
// IMPORTANTE: Configurar estas variables en el panel de Cloudflare (Settings > Variables)
// para mantener las claves seguras y poder cambiarlas fácilmente.

const DEFAULT_CONFIG = {
  // Configuración PRIMARY (Corresponde al Bucket INTERMEDIO - NeoMangas2)
  PRIMARY: {
    ACCESS_KEY_ID: '003f8dffc92c15b0000000001',
    SECRET_ACCESS_KEY: 'K003dGuOHI0UEnhHQh0HUMMbmDuVb0M',
    BUCKET_NAME: 'NeoMangas2',
    REGION: 'eu-central-003',
    ENDPOINT: 's3.eu-central-003.backblazeb2.com'
  },
  // Configuración SECONDARY (Corresponde al Bucket VIEJO - NeoMangas)
  SECONDARY: {
    ACCESS_KEY_ID: '003d6365952f9010000000001',
    SECRET_ACCESS_KEY: 'K003prqFINgITot+qLtSEBcAT2pXiOQ',
    BUCKET_NAME: 'NeoMangas',
    REGION: 'eu-central-003',
    ENDPOINT: 's3.eu-central-003.backblazeb2.com'
  },
  // Configuración TERTIARY (Corresponde al Bucket NUEVO)
  TERTIARY: {
    ACCESS_KEY_ID: '', // Configurar en Cloudflare ENV
    SECRET_ACCESS_KEY: '',
    BUCKET_NAME: '',
    REGION: '',
    ENDPOINT: ''
  }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Manejo de CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    // --- 1. Obtener la ruta limpia ---
    let path = url.pathname;
    try {
        path = decodeURIComponent(path);
    } catch (e) {}

    // Eliminar barras iniciales y espacios
    let key = path.replace(/^\/+/, '').trim();
    
    if (!key) {
      return new Response('NeoManga CDN Router Active', { status: 200 });
    }

    // --- 2. Preparar configuraciones desde ENV o defaults ---
    
    // OLD CONFIG (Mapeado a SECONDARY/NeoMangas)
    const oldConfig = {
      accessKeyId: env.SECONDARY_ACCESS_KEY_ID || DEFAULT_CONFIG.SECONDARY.ACCESS_KEY_ID,
      secretAccessKey: env.SECONDARY_SECRET_ACCESS_KEY || DEFAULT_CONFIG.SECONDARY.SECRET_ACCESS_KEY,
      bucketName: env.SECONDARY_BUCKET_NAME || DEFAULT_CONFIG.SECONDARY.BUCKET_NAME,
      region: env.SECONDARY_REGION || DEFAULT_CONFIG.SECONDARY.REGION,
      endpoint: env.SECONDARY_ENDPOINT || DEFAULT_CONFIG.SECONDARY.ENDPOINT
    };

    // INTERMEDIATE CONFIG (Mapeado a PRIMARY/NeoMangas2)
    const intermediateConfig = {
      accessKeyId: env.PRIMARY_ACCESS_KEY_ID || DEFAULT_CONFIG.PRIMARY.ACCESS_KEY_ID,
      secretAccessKey: env.PRIMARY_SECRET_ACCESS_KEY || DEFAULT_CONFIG.PRIMARY.SECRET_ACCESS_KEY,
      bucketName: env.PRIMARY_BUCKET_NAME || DEFAULT_CONFIG.PRIMARY.BUCKET_NAME,
      region: env.PRIMARY_REGION || DEFAULT_CONFIG.PRIMARY.REGION,
      endpoint: env.PRIMARY_ENDPOINT || DEFAULT_CONFIG.PRIMARY.ENDPOINT
    };

    // NEW CONFIG (Mapeado a TERTIARY)
    const newConfig = {
      accessKeyId: env.TERTIARY_ACCESS_KEY_ID || DEFAULT_CONFIG.TERTIARY.ACCESS_KEY_ID,
      secretAccessKey: env.TERTIARY_SECRET_ACCESS_KEY || DEFAULT_CONFIG.TERTIARY.SECRET_ACCESS_KEY,
      bucketName: env.TERTIARY_BUCKET_NAME || DEFAULT_CONFIG.TERTIARY.BUCKET_NAME,
      region: env.TERTIARY_REGION || DEFAULT_CONFIG.TERTIARY.REGION,
      endpoint: env.TERTIARY_ENDPOINT || DEFAULT_CONFIG.TERTIARY.ENDPOINT
    };

    // --- 3. INTENTO 1: Buscar en OLD BUCKET (Secondary/NeoMangas) ---
    let response;
    
    if (oldConfig.bucketName && oldConfig.accessKeyId) {
       response = await fetchFromBucket(key, oldConfig);
       
       if (response.status === 200 || response.status === 304) {
          const newHeaders = new Headers(response.headers);
          newHeaders.set('X-Source-Bucket', 'Old');
          return wrapResponse(response, newHeaders, key);
       }
    }

    // --- 4. INTENTO 2: Buscar en INTERMEDIATE BUCKET (Primary/NeoMangas2) ---
    if (!response || response.status === 404) {
        const intermediateResponse = await fetchFromBucket(key, intermediateConfig);
        
        if (intermediateResponse.status === 200 || intermediateResponse.status === 304) {
           const newHeaders = new Headers(intermediateResponse.headers);
           newHeaders.set('X-Source-Bucket', 'Intermediate');
           return wrapResponse(intermediateResponse, newHeaders, key);
        }
        response = intermediateResponse;
    }

    // --- 5. INTENTO 3: Buscar en NEW BUCKET (Tertiary) ---
    if ((!response || response.status === 404) && newConfig.bucketName && newConfig.accessKeyId) {
        const newResponse = await fetchFromBucket(key, newConfig);
        
        if (newResponse.status === 200 || newResponse.status === 304) {
           const newHeaders = new Headers(newResponse.headers);
           newHeaders.set('X-Source-Bucket', 'New');
           return wrapResponse(newResponse, newHeaders, key);
        }
        response = newResponse;
     }

    // Si response sigue siendo undefined (ninguna config válida), devolvemos 404 genérico
    if (!response) {
        return new Response('Not Found', { status: 404 });
    }

    return wrapResponse(response, new Headers(response.headers), key);
  },
};

// --- HELPER: Fetch from specific bucket with AWS Signature V4 ---
async function fetchFromBucket(key, config) {
    const now = new Date();
    const datetime = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
    const date = datetime.substr(0, 8); // YYYYMMDD

    // Path Style URI: /Bucket/Key
    const encodeSegment = (segment) => {
        return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    };
    
    const encodedKey = key.split('/').map(encodeSegment).join('/');
    const canonicalUri = `/${config.bucketName}/${encodedKey}`;

    const host = config.endpoint;
    const contentSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // Empty body hash

    const canonicalHeaders = 
      `host:${host}\n` +
      `x-amz-content-sha256:${contentSha256}\n` +
      `x-amz-date:${datetime}\n`;
      
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const method = 'GET';
    const canonicalRequest = 
      method + '\n' +
      canonicalUri + '\n' +
      '' + '\n' +
      canonicalHeaders + '\n' +
      signedHeaders + '\n' +
      contentSha256;

    const algorithm = 'AWS4-HMAC-SHA256';
    const scope = `${date}/${config.region}/s3/aws4_request`;
    const canonicalRequestHash = await sha256Hex(canonicalRequest);
    
    const stringToSign = 
      algorithm + '\n' +
      datetime + '\n' +
      scope + '\n' +
      canonicalRequestHash;

    const signingKey = await getSignatureKey(config.secretAccessKey, date, config.region, 's3');
    const signature = await hmacHex(signingKey, stringToSign);

    const authHeader = `${algorithm} Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    
    const fetchHeaders = new Headers();
    fetchHeaders.set('Authorization', authHeader);
    fetchHeaders.set('x-amz-date', datetime);
    fetchHeaders.set('x-amz-content-sha256', contentSha256);
    
    const finalUrl = `https://${config.endpoint}/${config.bucketName}/${encodedKey}`;

    try {
        const response = await fetch(finalUrl, {
            method: 'GET',
            headers: fetchHeaders
        });
        return response;
    } catch (error) {
        return new Response(null, { status: 404 });
    }
}

function wrapResponse(response, headers, key) {
    // Copiar headers
    const newHeaders = new Headers(headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Cache-Control', 'public, max-age=31536000');
    
    // Si es imagen, asegurar Content-Type correcto
    if (!newHeaders.has('Content-Type')) {
        if (key.endsWith('.webp')) newHeaders.set('Content-Type', 'image/webp');
        else if (key.endsWith('.jpg') || key.endsWith('.jpeg')) newHeaders.set('Content-Type', 'image/jpeg');
        else if (key.endsWith('.png')) newHeaders.set('Content-Type', 'image/png');
    }

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
    });
}

// --- CRYPTO HELPERS ---
async function sha256Hex(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return bufferToHex(hashBuffer);
}

async function hmacHex(key, message) {
    const msgBuffer = new TextEncoder().encode(message);
    const signature = await crypto.subtle.sign('HMAC', key, msgBuffer);
    return bufferToHex(signature);
}

async function getSignatureKey(key, dateStamp, regionName, serviceName) {
    const kDate = await hmacRaw(new TextEncoder().encode("AWS4" + key), dateStamp);
    const kRegion = await hmacRaw(kDate, regionName);
    const kService = await hmacRaw(kRegion, serviceName);
    const kSigning = await hmacRaw(kService, "aws4_request");
    return kSigning;
}

async function hmacRaw(key, message) {
    const msgBuffer = typeof message === 'string' ? new TextEncoder().encode(message) : message;
    const cryptoKey = await crypto.subtle.importKey(
        'raw', 
        key, 
        { name: 'HMAC', hash: 'SHA-256' }, 
        false, 
        ['sign']
    );
    return await crypto.subtle.sign('HMAC', cryptoKey, msgBuffer);
}

function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
