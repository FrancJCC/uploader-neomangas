
// CONFIGURACIÓN DE LOS BUCKETS
// IMPORTANTE: Configurar estas variables en el panel de Cloudflare (Settings > Variables)
// para mantener las claves seguras y poder cambiarlas fácilmente.

const DEFAULT_CONFIG = {
  // Configuración PRIMARY (Nuevo Bucket - NeoMangas2)
  PRIMARY: {
    ACCESS_KEY_ID: '003f8dffc92c15b0000000001',
    SECRET_ACCESS_KEY: 'K003dGuOHI0UEnhHQh0HUMMbmDuVb0M',
    BUCKET_NAME: 'NeoMangas2',
    REGION: 'eu-central-003',
    ENDPOINT: 's3.eu-central-003.backblazeb2.com'
  },
  // Configuración SECONDARY (Viejo Bucket - NeoMangas)
  SECONDARY: {
    ACCESS_KEY_ID: '003d6365952f9010000000001',
    SECRET_ACCESS_KEY: 'K003prqFINgITot+qLtSEBcAT2pXiOQ',
    BUCKET_NAME: 'NeoMangas',
    REGION: 'eu-central-003',
    ENDPOINT: 's3.eu-central-003.backblazeb2.com'
  },
  // Configuración TERTIARY (Tercer Bucket - El más antiguo/nuevo)
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
    
    // PRIMARY CONFIG
    const primaryConfig = {
      accessKeyId: env.PRIMARY_ACCESS_KEY_ID || DEFAULT_CONFIG.PRIMARY.ACCESS_KEY_ID,
      secretAccessKey: env.PRIMARY_SECRET_ACCESS_KEY || DEFAULT_CONFIG.PRIMARY.SECRET_ACCESS_KEY,
      bucketName: env.PRIMARY_BUCKET_NAME || DEFAULT_CONFIG.PRIMARY.BUCKET_NAME,
      region: env.PRIMARY_REGION || DEFAULT_CONFIG.PRIMARY.REGION,
      endpoint: env.PRIMARY_ENDPOINT || DEFAULT_CONFIG.PRIMARY.ENDPOINT
    };

    // SECONDARY CONFIG
    const secondaryConfig = {
      accessKeyId: env.SECONDARY_ACCESS_KEY_ID || DEFAULT_CONFIG.SECONDARY.ACCESS_KEY_ID,
      secretAccessKey: env.SECONDARY_SECRET_ACCESS_KEY || DEFAULT_CONFIG.SECONDARY.SECRET_ACCESS_KEY,
      bucketName: env.SECONDARY_BUCKET_NAME || DEFAULT_CONFIG.SECONDARY.BUCKET_NAME,
      region: env.SECONDARY_REGION || DEFAULT_CONFIG.SECONDARY.REGION,
      endpoint: env.SECONDARY_ENDPOINT || DEFAULT_CONFIG.SECONDARY.ENDPOINT
    };

    // TERTIARY CONFIG
    const tertiaryConfig = {
      accessKeyId: env.TERTIARY_ACCESS_KEY_ID || DEFAULT_CONFIG.TERTIARY.ACCESS_KEY_ID,
      secretAccessKey: env.TERTIARY_SECRET_ACCESS_KEY || DEFAULT_CONFIG.TERTIARY.SECRET_ACCESS_KEY,
      bucketName: env.TERTIARY_BUCKET_NAME || DEFAULT_CONFIG.TERTIARY.BUCKET_NAME,
      region: env.TERTIARY_REGION || DEFAULT_CONFIG.TERTIARY.REGION,
      endpoint: env.TERTIARY_ENDPOINT || DEFAULT_CONFIG.TERTIARY.ENDPOINT
    };

    // --- 3. INTENTO 1: Buscar en SECONDARY (Viejo - Prioridad 1) ---
    // Según instrucciones: Primero (Old), Luego (New), Luego (Tertiary)
    let response;
    
    // Si tenemos config secundaria válida, buscamos ahí primero
    if (secondaryConfig.bucketName && secondaryConfig.accessKeyId) {
       response = await fetchFromBucket(key, secondaryConfig);
       
       if (response.status === 200 || response.status === 304) {
          const newHeaders = new Headers(response.headers);
          newHeaders.set('X-Source-Bucket', 'Secondary');
          return wrapResponse(response, newHeaders, key);
       }
    }

    // --- 4. INTENTO 2: Si no está en el viejo, Buscar en PRIMARY (Nuevo - Prioridad 2) ---
    // Si la respuesta anterior fue undefined (no config) o 404, probamos el primario
    if (!response || response.status === 404) {
        const primaryResponse = await fetchFromBucket(key, primaryConfig);
        
        if (primaryResponse.status === 200 || primaryResponse.status === 304) {
           const newHeaders = new Headers(primaryResponse.headers);
           newHeaders.set('X-Source-Bucket', 'Primary');
           return wrapResponse(primaryResponse, newHeaders, key);
        }
        // Actualizamos la respuesta actual
        response = primaryResponse;
    }

    // --- 5. INTENTO 3: Si no está en los anteriores, Buscar en TERTIARY (Prioridad 3) ---
    if ((!response || response.status === 404) && tertiaryConfig.bucketName && tertiaryConfig.accessKeyId) {
        const tertiaryResponse = await fetchFromBucket(key, tertiaryConfig);
        
        if (tertiaryResponse.status === 200 || tertiaryResponse.status === 304) {
           const newHeaders = new Headers(tertiaryResponse.headers);
           newHeaders.set('X-Source-Bucket', 'Tertiary');
           return wrapResponse(tertiaryResponse, newHeaders, key);
        }
        // Si falla aquí, esta será la respuesta final
        response = tertiaryResponse;
     }

    // Si response sigue siendo undefined (ninguna config válida), devolvemos 404 genérico
    if (!response) {
        return new Response('Not Found', { status: 404 });
    }

    // Si llegamos aquí, devolvemos la respuesta final (probablemente 404)
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
        // En caso de error de red, devolvemos un objeto similar a response para manejarlo arriba
        return new Response(error.message, { status: 500 });
    }
}

// --- HELPER: Wrap response with common headers ---
function wrapResponse(response, headers, key) {
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    
    if (response.status === 200) {
        const ext = key.split('.').pop().toLowerCase();
        const mimeTypes = { 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif' };
        if (mimeTypes[ext]) headers.set('Content-Type', mimeTypes[ext]);
    } else {
        // Para errores, aseguramos texto plano
        headers.set('Content-Type', 'text/plain; charset=utf-8');
    }

    return new Response(response.body, {
      status: response.status,
      headers: headers
    });
}

// --- Criptografía (Reutilizada del original) ---

async function sha256Hex(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return bufferToHex(hashBuffer);
}

async function hmacHex(key, message) {
  let cryptoKey = key;
  if (!(key instanceof CryptoKey)) {
      cryptoKey = await crypto.subtle.importKey(
        'raw', 
        key, 
        { name: 'HMAC', hash: 'SHA-256' }, 
        false, 
        ['sign']
      );
  }
  const msgBuffer = new TextEncoder().encode(message);
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgBuffer);
  return bufferToHex(signatureBuffer);
}

async function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kSecret = new TextEncoder().encode("AWS4" + key);
  const kDate = await signRaw(kSecret, dateStamp);
  const kRegion = await signRaw(kDate, regionName);
  const kService = await signRaw(kRegion, serviceName);
  const kSigning = await signRaw(kService, "aws4_request");
  return kSigning;
}

async function signRaw(key, data) {
    let cryptoKey = key;
    if (key instanceof ArrayBuffer || key instanceof Uint8Array) {
        cryptoKey = await crypto.subtle.importKey(
            'raw', 
            key, 
            { name: 'HMAC', hash: 'SHA-256' }, 
            false, 
            ['sign']
        );
    }
    return await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
