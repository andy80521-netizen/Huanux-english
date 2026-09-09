import { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // 嘗試解析 multipart/form-data
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "No audio file provided in 'file' field" }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 準備傳送給 OpenAI 的 FormData
    const openAiFormData = new FormData();
    openAiFormData.append("file", file);
    openAiFormData.append("model", "whisper-1");
    openAiFormData.append("response_format", "verbose_json");
    // 注意：針對陣列參數，有些 API 接受 timestamp_granularities[]，Node 的 fetch 也支援直接 append
    openAiFormData.append("timestamp_granularities[]", "segment");

    // 呼叫 OpenAI Whisper API
    const openAiResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`
        // 注意: 使用 fetch 傳送 FormData 時，絕對不能手動設定 Content-Type，
        // 瀏覽器/Node 會自動補上帶有正確 boundary 的 multipart/form-data
      },
      body: openAiFormData
    });

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      console.error("OpenAI API Error:", data);
      return new Response(JSON.stringify({ error: "OpenAI API request failed", details: data }), { 
        status: openAiResponse.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 將 Whisper 回傳的 segments 轉換為需求格式
    const results = (data.segments || []).map((seg: any) => ({
      text: seg.text,
      startTime: seg.start,
      endTime: seg.end
    }));

    return new Response(JSON.stringify(results), { 
      status: 200, 
      headers: { "Content-Type": "application/json" } 
    });

  } catch (error: any) {
    console.error("Transcription error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", message: error.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
