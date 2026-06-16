require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
  try {
    console.log('API Key:', process.env.GEMINI_API_KEY?.substring(0, 15) + '...');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Try to list models
    const models = await genAI.listModels();
    console.log('\nAvailable models:');
    models.forEach(m => {
      console.log(`- ${m.name}`);
    });
  } catch (error) {
    console.error('Error:', error.message);
    console.error('\nLookslike API key might be invalid or expired.');
    console.error('Please get a new one from: https://ai.google.dev/tutorials/setup');
  }
}

listModels();
