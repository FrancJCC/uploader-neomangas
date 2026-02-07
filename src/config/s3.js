const { S3Client } = require('@aws-sdk/client-s3');
const env = require('./env');
const { getActiveBucket } = require('./storage');

function createS3Client(bucketConfig) {
    return new S3Client({
        region: bucketConfig.region,
        endpoint: `https://${bucketConfig.endpoint}`,
        credentials: {
            accessKeyId: bucketConfig.key,
            secretAccessKey: bucketConfig.secret
        },
        forcePathStyle: false
    });
}

// Get active bucket config
const activeBucket = getActiveBucket();

// Create default client for backward compatibility
const defaultClient = createS3Client(activeBucket);

// Attach factory method to the default client instance (so we can require('./s3').createS3Client if needed, 
// though require('./s3') returns the client object directly)
defaultClient.createS3Client = createS3Client;

module.exports = defaultClient;
