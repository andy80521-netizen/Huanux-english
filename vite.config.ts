import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    // Simple Vite plugin to mock Netlify Functions in local dev
    const netlifyFunctionsPlugin = () => ({
      name: 'netlify-functions-dev',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/.netlify/functions/')) {
            const urlPath = req.url.split('?')[0];
            const functionName = urlPath.split('/')[3];
            const funcPath = path.resolve(__dirname, `netlify/functions/${functionName}.ts`);
            
            if (!fs.existsSync(funcPath)) {
                res.statusCode = 404;
                return res.end(JSON.stringify({ error: 'Function not found' }));
            }
            
            try {
              // Load the function dynamically
              const module = await server.ssrLoadModule(funcPath);
              
              // Read request body
              let body = '';
              req.on('data', chunk => { body += chunk.toString(); });
              req.on('end', async () => {
                // Inject process.env for local dev
                process.env.GEMINI_API_KEY = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
                process.env.OPENAI_API_KEY = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;

                if (typeof module.handler === 'function') {
                  const event = {
                    httpMethod: req.method,
                    body,
                    headers: req.headers,
                  };
                  const result = await module.handler(event, {});
                  res.statusCode = result.statusCode || 200;
                  for (const [key, val] of Object.entries(result.headers || {})) {
                    res.setHeader(key, val);
                  }
                  res.end(result.body || '');
                } else if (typeof module.default === 'function') {
                  const fullUrl = `http://${req.headers.host || 'localhost:3000'}${req.url}`;
                  const webReq = new Request(fullUrl, {
                    method: req.method,
                    headers: req.headers as Record<string, string>,
                    body: (req.method !== 'GET' && req.method !== 'HEAD') ? body : undefined,
                  });
                  const webRes: Response = await module.default(webReq, {});
                  res.statusCode = webRes.status;
                  webRes.headers.forEach((v, k) => {
                    res.setHeader(k, v);
                  });
                  const resBody = await webRes.text();
                  res.end(resBody);
                } else {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: 'Function handler not found' }));
                }
              });
            } catch (e: any) {
              console.error('Netlify function error:', e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          } else {
            next();
          }
        });
      }
    });

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: true,
      },
      plugins: [
        react(),
        netlifyFunctionsPlugin()
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
