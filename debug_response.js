const axios = require('axios');
require('dotenv').config();

const API_URL = process.env.API_URL || 'http://localhost:3000';
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

async function test() {
    try {
        console.log('Logging in...');
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: EMAIL,
            password: PASSWORD
        });
        const token = loginRes.data.accessToken;
        
        // Get a manga
        const mangasRes = await axios.get(`${API_URL}/manga`);
        const manga = mangasRes.data[0];
        if (!manga) return console.log('No manga found');

        console.log(`Checking series: ${manga.title}`);
        
        // Get chapters list (LIGHT version)
        const url = `${API_URL}/chapters/series/${manga._id}`;
        console.log(`GET ${url}`);
        const res = await axios.get(url);
        
        const first = res.data[0];
        console.log('First chapter keys:', Object.keys(first));
        console.log('Pages prop:', first.pages);
        console.log('Is pages array?', Array.isArray(first.pages));
        console.log('Length:', first.pages ? first.pages.length : 'N/A');

        // Test Individual Fetch
        console.log(`\nFetching details for Chapter ID: ${first._id}`);
        const detailRes = await axios.get(`${API_URL}/chapters/${first._id}`);
        const detail = detailRes.data;
        
        console.log('Detail keys:', Object.keys(detail));
        console.log('Detail pages length:', detail.pages ? detail.pages.length : 'undefined');
        console.log('First page URL:', detail.pages && detail.pages.length > 0 ? detail.pages[0] : 'N/A');

    } catch (e) {
        console.error(e.message);
    }
}

test();