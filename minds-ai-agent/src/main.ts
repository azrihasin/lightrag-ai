import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });

  // Replace NestJS default logger with Pino
  app.useLogger(app.get(Logger));

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    // 'Range' is required so protomaps-leaflet/pmtiles can fetch byte ranges from
    // the static .pmtiles archives; expose the range response headers back.
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'Range'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
  });

  app.use(require('express').json({ limit: '2mb' }));

  // Serve the coverage/congestion PMTiles archives. protomaps-leaflet fetches
  // them with HTTP Range requests, which express.static honours (Accept-Ranges).
  // CORS is already enabled above, so the 5173 frontend can read them cross-origin.
  const express = require('express');
  const pathMod = require('path');
  const mapTilesDir =
    process.env.MAP_TILES_DIR ?? pathMod.join(process.cwd(), 'map-tiles');
  app.use(
    '/map-tiles',
    express.static(mapTilesDir, {
      // acceptRanges lets express.static answer `Range:` requests with
      // 206 Partial Content + Content-Range, so the pmtiles client fetches one
      // tile's bytes instead of the whole archive. pmtiles@3 actually THROWS on a
      // 200 full-body response, so 206 is required, not just an optimisation.
      acceptRanges: true,
      setHeaders: (res: any, filePath: string) => {
        res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        // express resolves .pmtiles to application/octet-stream (works, but the
        // canonical type is clearer for clients/proxies). Advertise byte-range
        // support explicitly so range-capable clients use it.
        if (filePath.endsWith('.pmtiles')) {
          res.setHeader('Content-Type', 'application/vnd.pmtiles');
          res.setHeader('Accept-Ranges', 'bytes');
        }
      },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Minds AI Agent')
    .setDescription('Streaming AI chat agent API')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customCssUrl: 'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css',
    customJs: [
      'https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js',
      'https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js',
    ],
  });

  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`Server running on http://localhost:${port}`, 'Bootstrap');
  logger.log(`Swagger docs at http://localhost:${port}/api/docs`, 'Bootstrap');
}

bootstrap();
