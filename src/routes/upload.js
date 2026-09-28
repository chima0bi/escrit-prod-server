import { Router } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';

export const uploadRouter = Router();

const cloudinaryConfigured = Object.values(env.cloudinary).every(Boolean);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
  });
}

// Keep uploads in memory so Render's ephemeral filesystem is never the storage layer.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith('image/')) callback(null, true);
    else callback(new AppError(400, 'Choose an image file.'));
  },
});

function requireCloudinary(_req, _res, next) {
  if (!cloudinaryConfigured) {
    return next(new AppError(503, 'Photo storage is not configured.'));
  }
  next();
}

function handleUploadError(error, _req, _res, next) {
  if (error instanceof multer.MulterError) {
    const isOversized = error.code === 'LIMIT_FILE_SIZE';
    return next(new AppError(isOversized ? 413 : 400, isOversized ? 'Photo must be 5 MB or smaller.' : 'Photo upload is invalid.'));
  }
  next(error);
}

function cloudinaryOptions() {
  return {
    folder: 'escrit',
    resource_type: 'image',
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  };
}

function uploadBuffer(buffer) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(cloudinaryOptions(), (error, result) => {
      if (error) reject(new AppError(502, 'Photo upload failed.'));
      else resolve(result);
    }).end(buffer);
  });
}

uploadRouter.post(
  '/photo',
  requireAuth,
  requireCloudinary,
  upload.single('photo'),
  handleUploadError,
  asyncHandler(async (req, res) => {
    let result;
    if (req.file) {
      result = await uploadBuffer(req.file.buffer);
    } else if (typeof req.body?.url === 'string') {
      let source;
      try {
        source = new URL(req.body.url);
        if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) {
          throw new Error('Invalid photo URL');
        }
      } catch {
        throw new AppError(400, 'Enter a valid public photo URL.');
      }

      // Store URL imports in Cloudinary too, so listings do not depend on the source host.
      try {
        result = await cloudinary.uploader.upload(source.href, cloudinaryOptions());
      } catch {
        throw new AppError(422, 'That photo URL could not be imported.');
      }
    } else {
      throw new AppError(400, 'Choose a photo or provide a photo URL.');
    }

    if (!result?.secure_url) throw new AppError(502, 'Photo storage did not return a secure URL.');
    res.status(201).json({ url: result.secure_url });
  })
);
