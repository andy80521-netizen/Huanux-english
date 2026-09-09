import fs from 'fs/promises';

const apiKey = process.env.OPENAI_API_KEY;
const filePath = 'The Daily Aus-Headlines_ Govt announces social media algorithm opt-out.mp3';

async function testModel(modelName) {
  console.log(`\n========================================`);
  console.log(`Model: ${modelName}`);
  const start = Date.now();
  try {
    const fileData = await fs.readFile(filePath);
    const file = new File([fileData], 'audio.mp3', { type: 'audio/mpeg' });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', modelName);
    // As per the previous error, these models ONLY support 'json' or 'text'
    formData.append('response_format', 'json');
    // We omit timestamp_granularities because it usually requires verbose_json

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    const timeTaken = Date.now() - start;
    const result = await response.json();

    if (!response.ok) {
      console.log(`Status: FAILED`);
      console.log(`Time taken: ${timeTaken}ms`);
      console.log(`Error:`, result.error?.message || JSON.stringify(result));
    } else {
      console.log(`Status: SUCCESS`);
      console.log(`Time taken: ${timeTaken}ms`);
      console.log(`Returned keys:`, Object.keys(result));
      if (result.segments) {
        result.segments.forEach(s => {
           console.log(`[${s.start?.toFixed(2)} - ${s.end?.toFixed(2)}] ${s.text}`);
        });
      } else if (result.text) {
         console.log(`Text (first 300 chars):`, result.text.substring(0, 300) + '...');
      } else {
         console.log(`Result:`, result);
      }
    }
  } catch (err) {
    const timeTaken = Date.now() - start;
    console.log(`Status: EXCEPTION`);
    console.log(`Time taken: ${timeTaken}ms`);
    console.log(`Error:`, err.message);
  }
}

async function run() {
  await testModel('gpt-4o-transcribe');
  await testModel('gpt-4o-mini-transcribe');
}

run();
