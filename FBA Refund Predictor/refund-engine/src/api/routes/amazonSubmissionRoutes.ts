import { Router } from 'express';
import AmazonSubmissionController from '../controllers/amazonSubmissionController';

const router = Router();

router.get('/metrics', AmazonSubmissionController.metrics);
router.get('/health', AmazonSubmissionController.health);
router.get('/in-progress', AmazonSubmissionController.inProgress);

export { router };

