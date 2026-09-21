export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

  if (!apiKey) {
    return Response.json(
      { error: 'Missing GEMINI_API_KEY.' },
      { status: 500 }
    );
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON.' },
      { status: 400 }
    );
  }

  const system =
    typeof body.system === 'string'
      ? body.system.slice(0, 12000)
      : '';

  const messages =
    Array.isArray(body.messages)
      ? body.messages.slice(-20)
      : [];

  if (!system || !messages.length) {
    return Response.json(
      { error: 'Missing system or messages.' },
      { status: 400 }
    );
  }

  try {
    const contents = messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text: String(message.content || '').slice(0, 4000)
        }
      ]
    }));

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: system
              }
            ]
          },

          contents,

          generationConfig: {
            maxOutputTokens: 500,
            temperature: 0.4
          }
        })
      }
    );

    const data = await upstream.json();

    if (!upstream.ok) {
      return Response.json(
        {
          error:
            data?.error?.message ||
            'Gemini request failed.'
        },
        { status: upstream.status }
      );
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('')
        .trim();

    if (!text) {
      return Response.json(
        { error: 'Gemini returned no text.' },
        { status: 502 }
      );
    }

    return Response.json({ text });

  } catch (err) {
    return Response.json(
      {
        error: err.message || 'AI proxy failed.'
      },
      { status: 500 }
    );
  }
};