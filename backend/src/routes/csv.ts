import { FastifyInstance, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/prisma.js';
import { uploadFile, getFileAsString, deleteFile } from '../lib/s3.js';
import { parseCsv, getCsvPreview } from '../services/csv-parser.js';

export async function csvRoutes(app: FastifyInstance) {
  // Upload a new CSV file
  app.post('/upload', async (request: FastifyRequest, reply) => {
    const data = await request.file();
    
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }
    
    const buffer = await data.toBuffer();
    const content = buffer.toString('utf-8');
    
    // Parse and validate CSV
    let parsed;
    try {
      parsed = parseCsv(content);
    } catch (error) {
      return reply.status(400).send({
        error: 'Invalid CSV file',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    
    if (parsed.columns.length === 0) {
      return reply.status(400).send({
        error: 'Empty CSV file',
        details: 'CSV file must have at least one column header',
      });
    }
    
    // Upload to S3
    const s3Key = `csv/${nanoid()}.csv`;
    await uploadFile(s3Key, buffer, 'text/csv');
    
    // Save to database
    const csvFile = await prisma.csvFile.create({
      data: {
        name: data.filename.replace(/\.csv$/i, ''),
        originalName: data.filename,
        s3Key,
        columnNames: parsed.columns,
        rowCount: parsed.rowCount,
      },
    });
    
    return {
      id: csvFile.id,
      name: csvFile.name,
      originalName: csvFile.originalName,
      columnNames: csvFile.columnNames,
      rowCount: csvFile.rowCount,
      createdAt: csvFile.createdAt,
    };
  });
  
  // List all CSV files
  app.get('/', async () => {
    const csvFiles = await prisma.csvFile.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        originalName: true,
        columnNames: true,
        rowCount: true,
        createdAt: true,
      },
    });
    return csvFiles;
  });
  
  // Get a single CSV file
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const csvFile = await prisma.csvFile.findUnique({
      where: { id: request.params.id },
    });
    
    if (!csvFile) {
      return reply.status(404).send({ error: 'CSV file not found' });
    }
    
    return {
      id: csvFile.id,
      name: csvFile.name,
      originalName: csvFile.originalName,
      columnNames: csvFile.columnNames,
      rowCount: csvFile.rowCount,
      createdAt: csvFile.createdAt,
    };
  });
  
  // Get CSV preview (first 5 rows)
  app.get('/:id/preview', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const csvFile = await prisma.csvFile.findUnique({
      where: { id: request.params.id },
    });
    
    if (!csvFile) {
      return reply.status(404).send({ error: 'CSV file not found' });
    }
    
    const content = await getFileAsString(csvFile.s3Key);
    const preview = getCsvPreview(content, 5);
    
    return {
      columns: preview.columns,
      rows: preview.rows,
      totalRows: csvFile.rowCount,
    };
  });
  
  // Delete a CSV file
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const csvFile = await prisma.csvFile.findUnique({
      where: { id: request.params.id },
    });
    
    if (!csvFile) {
      return reply.status(404).send({ error: 'CSV file not found' });
    }
    
    // Check if CSV is used in any runs
    const runCount = await prisma.run.count({
      where: { csvFileId: csvFile.id },
    });
    
    if (runCount > 0) {
      return reply.status(400).send({
        error: 'CSV file is used in runs',
        details: `This CSV file is used in ${runCount} run(s). Delete the runs first.`,
      });
    }
    
    // Delete from S3
    await deleteFile(csvFile.s3Key);
    
    // Delete from database
    await prisma.csvFile.delete({
      where: { id: csvFile.id },
    });
    
    return { success: true };
  });
}
