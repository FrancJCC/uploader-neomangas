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
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Expose-Headers': 'ETag'
        },
      });
    }

    // --- 1. Preparar configuraciones desde ENV o defaults ---
    
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

    const configs = [oldConfig, intermediateConfig, newConfig].filter(c => c.bucketName && c.accessKeyId);

    // --- 2. Determinación de Ruta y Bucket Específico ---
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch (e) {}
    
    // Detectar si la ruta empieza con el nombre de un bucket (Path Style Support)
    // Ejemplo: /NeoMangas/path/to/file.webp
    let targetConfig = null;
    let key = path.replace(/^\/+/, '').trim(); // Default key
    
    // Check Hostname (Virtual Host Style)
    // TODO: Implementar si se usa DNS wildcard, pero por ahora nos enfocamos en Path Style que es más común con Workers

    // Check Path Prefix
    for (const config of configs) {
        if (path.startsWith(`/${config.bucketName}/`)) {
            targetConfig = config;
            // Remove bucket name from key
            key = path.replace(new RegExp(`^/${config.bucketName}/`), '').replace(/^\/+/, '').trim();
            break;
        } else if (path === `/${config.bucketName}`) { // Root of bucket
            targetConfig = config;
            key = '';
            break;
        }
    }

    // Permitir root (key vacía) solo si es ListObjects (tiene params)
    const isListObjects = url.searchParams.has('list-type') || url.searchParams.has('prefix');
    
    if (!key && !isListObjects && !targetConfig) {
      return new Response('NeoManga CDN Router Active', { status: 200 });
    }

    // --- 3. LÓGICA DE PROXY ---
    
    // CASO A: Bucket Específico Detectado (Backend Operations / Explicit Path)
    if (targetConfig) {
        const response = await fetchFromBucket(key, targetConfig, request);
        // Si falla con bucket específico, devolvemos el error tal cual (no fallback)
        // Excepto si es 404 y es un GET, tal vez queramos fallback? 
        // NO, si el cliente pidió un bucket específico, espera respuesta de ESE bucket.
        // Esto es crucial para operaciones de listado/borrado/escritura.
        return wrapResponse(response, response.headers, key);
    }

    // CASO B: Unified Namespace (CDN Mode - Try All)
    // Solo para GET/HEAD. Si es PUT/DELETE sin bucket, es peligroso o ambiguo.
    // Asumiremos que PUT/DELETE siempre deben venir con bucket en path si usamos el SDK correctamente.
    // Pero si llega un DELETE /foo.jpg, ¿qué hacemos? 
    // Opción: Intentar borrar en todos? O borrar en el primero que exista?
    // Mejor: Si es WRITE method y no hay bucket, rechazar o intentar en el Default (Intermediate)?
    // Por seguridad, para modificaciones requerimos Bucket explícito (Path Style).
    if (request.method !== 'GET' && request.method !== 'HEAD') {
         return new Response('Method requires explicit bucket in path (Path Style)', { status: 400 });
    }

    // Loop para GET (CDN)
    let response;
    
    // INTENTO 1: OLD BUCKET
    if (oldConfig.bucketName && oldConfig.accessKeyId) {
       response = await fetchFromBucket(key, oldConfig, request);
       if (isSuccess(response)) return wrapResponse(response, response.headers, key);
    }

    // INTENTO 2: INTERMEDIATE BUCKET
    if (shouldContinue(response) && intermediateConfig.bucketName && intermediateConfig.accessKeyId) {
        const intermediateResponse = await fetchFromBucket(key, intermediateConfig, request);
        if (isSuccess(intermediateResponse)) return wrapResponse(intermediateResponse, intermediateResponse.headers, key);
        response = intermediateResponse;
    }

    // INTENTO 3: NEW BUCKET
    if (shouldContinue(response) && newConfig.bucketName && newConfig.accessKeyId) {
        const newResponse = await fetchFromBucket(key, newConfig, request);
        if (isSuccess(newResponse)) return wrapResponse(newResponse, newResponse.headers, key);
        response = newResponse;
     }

    // Fallback
    if (!response) {
        return new Response('Not Found', { status: 404 });
    }

    return wrapResponse(response, response.headers, key);
  },
};

function isSuccess(response) {
    return response && (response.status >= 200 && response.status < 300 || response.status === 304);
}

function shouldContinue(response) {
    // Continuar si no hay respuesta o es 404/403 (Maybe file not in this bucket)
    return !response || response.status === 404 || response.status === 403;
}

// --- HELPER: Fetch from specific bucket with AWS Signature V4 ---
async function fetchFromBucket(key, config, originalRequest) {
    const now = new Date();
    const datetime = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
    const date = datetime.substr(0, 8); // YYYYMMDD
    const method = originalRequest.method;
    const url = new URL(originalRequest.url);

    // Path Style URI: /Bucket/Key
    const encodeSegment = (segment) => {
        return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    };
    
    // Construir URI canónica
    let canonicalUri = '/';
    if (key) {
        const encodedKey = key.split('/').map(encodeSegment).join('/');
        canonicalUri = `/${config.bucketName}/${encodedKey}`;
    } else {
        canonicalUri = `/${config.bucketName}/`; // Root for ListObjects
    }

    const host = config.endpoint;
    
    // Hash del Body
    let bodyBuffer = new Uint8Array(0);
    if (method !== 'GET' && method !== 'HEAD') {
        try {
            bodyBuffer = new Uint8Array(await originalRequest.clone().arrayBuffer());
        } catch (e) {}
    }
    const contentSha256 = await sha256Hex(bodyBuffer);

    // Canonical Query String (Sorted)
    const searchParams = new URLSearchParams(url.search);
    searchParams.sort();
    const canonicalQueryString = [...searchParams.entries()]
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
        .join('&');

    // Headers Canónicos
    let canonicalHeaders = 
      `host:${host}\n` +
      `x-amz-content-sha256:${contentSha256}\n` +
      `x-amz-date:${datetime}\n`;
      
    let signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    // Manejar headers extra necesarios
    const extraHeadersToSign = ['x-amz-copy-source', 'x-amz-acl', 'content-type'];
    const originalHeaders = originalRequest.headers;
    
    for (const header of extraHeadersToSign) {
        if (originalHeaders.has(header)) {
            canonicalHeaders += `${header}:${originalHeaders.get(header).trim()}\n`;
            signedHeaders += `;${header}`;
        }
    }

    const canonicalRequest = 
      method + '\n' +
      canonicalUri + '\n' +
      canonicalQueryString + '\n' +
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
    
    for (const header of extraHeadersToSign) {
        if (originalHeaders.has(header)) {
            fetchHeaders.set(header, originalHeaders.get(header));
        }
    }

    let finalUrl = `https://${config.endpoint}${canonicalUri}`;
    if (canonicalQueryString) {
        finalUrl += `?${canonicalQueryString}`;
    }

    try {
        const response = await fetch(finalUrl, {
            method: method,
            headers: fetchHeaders,
            body: (method === 'GET' || method === 'HEAD') ? null : bodyBuffer
        });
        return response;
    } catch (error) {
        return new Response(null, { status: 502 });
    }
}

function wrapResponse(response, headers, key) {
    const newHeaders = new Headers(headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    newHeaders.set('Access-Control-Expose-Headers', 'ETag');
    
    if (response.status === 200 && (!headers.has('Cache-Control'))) {
         newHeaders.set('Cache-Control', 'public, max-age=31536000');
    }
    
    if (!newHeaders.has('Content-Type') && key) {
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
    const msgBuffer = typeof message === 'string' ? new TextEncoder().encode(message) : message;
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
