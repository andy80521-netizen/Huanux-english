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
            const functionName = req.url.split('/')[3];
            const funcPath = path.resolve(__dirname, `netlify/functions/${functionName}.ts`);
            
            if (!fs.existsSync(funcPath)) {
                res.statusCode = 404;
                return res.end('Function not found');
            }
            
            try {
              // Load the function dynamically
              const module = await server.ssrLoadModule(funcPath);
              
              // Read request body
              let body = '';
              req.on('data', chunk => { body += chunk.toString(); });
              req.on('end', async () => {
                const event = {
                  httpMethod: req.method,
                  body,
                  headers: req.headers,
                };
                
                // Inject process.env for local dev
                process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;

                // Call the Netlify handler
                const result = await module.handler(event, {});
                
                res.statusCode = result.statusCode || 200;
                for (const [key, val] of Object.entries(result.headers || {})) {
                  res.setHeader(key, val);
                }
                res.end(result.body || '');
              });
            } catch (e) {
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
