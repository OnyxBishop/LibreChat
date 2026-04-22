import { Request, Response } from 'express';
import OpenAI from 'openai';
import fs from 'fs';

const openai = new OpenAI({
  apiKey: process.env.AITUNNEL_KEY ?? '',
  baseURL: 'https://api.aitunnel.ru/v1/',
});

export const streamTranscription = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).send('No audio file provided.');
    }

    // Using client compatible with OpenAI SDK
    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(req.file.path),
    });

    res.status(200).json({ text: transcription.text });
  } catch (error) {
    console.error('STT stream error:', error);
    res.status(500).send('Error processing audio transcription.');
  }
};