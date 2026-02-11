const env = require('./env');

const BUCKETS = {
    PRIMARY: {
        id: 'PRIMARY',
        name: env.S3.BUCKETS.NEOMANGAS.NAME,
        key: env.S3.BUCKETS.NEOMANGAS.KEY,
        secret: env.S3.BUCKETS.NEOMANGAS.SECRET,
        role: 'ACTIVE_WRITE',
        endpoint: env.S3.ENDPOINT.replace('https://', ''),
        region: env.S3.REGION
    },
    SECONDARY: {
        id: 'SECONDARY',
        name: env.S3.BUCKETS.NEOMANGAS2.NAME,
        key: env.S3.BUCKETS.NEOMANGAS2.KEY,
        secret: env.S3.BUCKETS.NEOMANGAS2.SECRET,
        role: 'RESERVE',
        endpoint: env.S3.ENDPOINT.replace('https://', ''),
        region: env.S3.REGION
    },
    TERTIARY: {
        id: 'TERTIARY',
        name: env.S3.BUCKETS.NEOMANGAS3.NAME,
        key: env.S3.BUCKETS.NEOMANGAS3.KEY,
        secret: env.S3.BUCKETS.NEOMANGAS3.SECRET,
        role: 'RESERVE',
        endpoint: env.S3.ENDPOINT.replace('https://', ''),
        region: env.S3.REGION
    }
};

// Variable local para mantener el estado del bucket activo durante la ejecución
let activeBucketOverride = null;

function getActiveBucket() {
    // 1. Si hay un override en tiempo de ejecución (por failover), usarlo
    if (activeBucketOverride) {
        return activeBucketOverride;
    }

    // 2. Si hay una variable S3_BUCKET explícita en .env, buscamos ese bucket
    if (env.S3.BUCKET) {
        const found = Object.values(BUCKETS).find(b => b.name === env.S3.BUCKET);
        if (found) return found;
    }
    
    // 3. Si no, devolvemos el marcado como ACTIVE_WRITE
    return Object.values(BUCKETS).find(b => b.role === 'ACTIVE_WRITE') || BUCKETS.PRIMARY;
}

function setActiveBucket(bucketConfig) {
    activeBucketOverride = bucketConfig;
}

module.exports = {
    BUCKETS,
    getActiveBucket,
    setActiveBucket
};
