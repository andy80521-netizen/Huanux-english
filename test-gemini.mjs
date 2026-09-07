import { splitTextToSentences, extractPatternsFromText } from './src/services/gemini.ts';

async function runTest() {
    console.log("=== 測試 Flow 5: 萃取語言模型 ===");
    const text = "Hi, how are you? I've been working on a really difficult project recently. It took a lot of effort, but it's finally paying off.";
    console.log("Input Text:", text);
    
    try {
        console.log("1. 呼叫 splitTextToSentences...");
        const sentences = await splitTextToSentences(text);
        console.log("拆句結果:", JSON.stringify(sentences, null, 2));
        
        console.log("2. 呼叫 extractPatternsFromText...");
        const patterns = await extractPatternsFromText(text);
        console.log("萃取結果:", JSON.stringify(patterns, null, 2));
        
    } catch (e) {
        console.error("測試發生錯誤:", e);
    }
}

runTest();
