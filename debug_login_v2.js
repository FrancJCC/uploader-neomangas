require('dotenv').config();
const axios = require('axios');

const API_URL = process.env.API_URL;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

async function debug() {
    try {
        console.log('--- DEBUG INFO V2 ---');
        console.log('Intentando login...');
        
        const response = await axios.post(`${API_URL}/auth/login`, {
            email: EMAIL,
            password: PASSWORD
        });

        console.log('\n✅ Login RESPONSE STATUS:', response.status);
        console.log('KEYS in response.data:', Object.keys(response.data));
        
        // Print the full response structure (without values for token)
        const safeLog = JSON.parse(JSON.stringify(response.data));
        if (safeLog.access_token) safeLog.access_token = '***HIDDEN***';
        if (safeLog.token) safeLog.token = '***HIDDEN***';
        
        console.log('FULL RESPONSE DATA:', JSON.stringify(safeLog, null, 2));

    } catch (error) {
        console.error('❌ Login Error:', error.message);
        if (error.response) {
            console.error('Response Data:', error.response.data);
            console.error('Response Status:', error.response.status);
        }
    }
}

debug();
