const mongoose = require('mongoose');
const env = require('./env');
const colors = require('colors');

const connectDB = async () => {
    try {
        const uri = env.MONGO_URI || '';
        // Mask password for logging
        const maskedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
        // console.log(`🔌 Conectando a MongoDB: ${maskedUri}`);
        
        const conn = await mongoose.connect(env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
            socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
        });
        // console.log(`MongoDB Connected: ${conn.connection.host}`.cyan.underline);
        return conn;
    } catch (error) {
        console.error(`Error de conexión MongoDB: ${error.message}`.red.bold);
        process.exit(1);
    }
};

const disconnectDB = async () => {
    try {
        await mongoose.disconnect();
        // console.log('MongoDB Disconnected'.gray);
    } catch (error) {
        console.error(`Error desconectando MongoDB: ${error.message}`.red);
    }
};

module.exports = { connectDB, disconnectDB };