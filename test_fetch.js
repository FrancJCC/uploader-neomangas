require('dotenv').config();
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

async function test() {
    try {
        // 1. Login
        console.log('Logging in...');
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: EMAIL,
            password: PASSWORD
        });
        const token = loginRes.data.accessToken;
        console.log('Login successful.');

        // 2. Get Mangas to find a series
        const mangasRes = await axios.get(`${API_URL}/manga`);
        const manga = mangasRes.data[0];
        if (!manga) {
            console.log('No mangas found.');
            return;
        }
        console.log(`Using manga: ${manga.title} (${manga._id})`);

        // 3. Get Chapters List (this is what is currently failing to return pages)
        console.log('Fetching chapters list...');
        const chaptersRes = await axios.get(`${API_URL}/chapters/series/${manga._id}?includePages=true`);
        const firstChapter = chaptersRes.data[0];

        if (!firstChapter) {
            console.log('No chapters found for this series.');
            return;
        }

        console.log(`First chapter from list: ID=${firstChapter._id}, Pages count=${firstChapter.pages ? firstChapter.pages.length : 'UNDEFINED'}`);

        // 4. Get Single Chapter Detail (The proposed workaround)
        console.log(`Fetching single chapter detail for ID ${firstChapter._id}...`);
        const detailRes = await axios.get(`${API_URL}/chapters/${firstChapter._id}`);
        const detailChapter = detailRes.data;

        console.log(`Single chapter detail: ID=${detailChapter._id}, Pages count=${detailChapter.pages ? detailChapter.pages.length : 'UNDEFINED'}`);

        if (!firstChapter.pages && detailChapter.pages) {
            console.log('SUCCESS: Workaround confirmed. List lacks pages, Detail has pages.');
        } else if (firstChapter.pages) {
            console.log('NOTE: List ALREADY has pages (maybe backend was fixed?).');
        } else {
            console.log('FAILURE: Neither list nor detail has pages.');
        }

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) console.error('Response data:', error.response.data);
    }
}

test();