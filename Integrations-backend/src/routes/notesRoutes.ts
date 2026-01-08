import express from 'express';
import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';

const router = express.Router();

/**
 * @route GET /api/notes
 * @desc Get all notes for the authenticated user
 */
router.get('/', async (req: any, res) => {
    try {
        const userId = req.userId || 'demo-user';

        const { data, error } = await supabase
            .from('user_notes')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('Error fetching notes', { error, userId });
            return res.status(500).json({ success: false, error: 'Failed to fetch notes' });
        }

        res.json({ success: true, data });
    } catch (error: any) {
        logger.error('Unexpected error in GET /api/notes', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route POST /api/notes
 * @desc Create a new note
 */
router.post('/', async (req: any, res) => {
    try {
        const userId = req.userId || 'demo-user';
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({ success: false, error: 'Note content is required' });
        }

        const { data, error } = await supabase
            .from('user_notes')
            .insert({
                user_id: userId,
                content,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            logger.error('Error creating note', { error, userId });
            return res.status(500).json({ success: false, error: 'Failed to create note' });
        }

        res.json({ success: true, data });
    } catch (error: any) {
        logger.error('Unexpected error in POST /api/notes', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route DELETE /api/notes/:id
 * @desc Delete a note
 */
router.delete('/:id', async (req: any, res) => {
    try {
        const userId = req.userId || 'demo-user';
        const { id } = req.params;

        const { error } = await supabase
            .from('user_notes')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);

        if (error) {
            logger.error('Error deleting note', { error, id, userId });
            return res.status(500).json({ success: false, error: 'Failed to delete note' });
        }

        res.json({ success: true, message: 'Note deleted successfully' });
    } catch (error: any) {
        logger.error('Unexpected error in DELETE /api/notes', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route PATCH /api/notes/:id
 * @desc Update a note
 */
router.patch('/:id', async (req: any, res) => {
    try {
        const userId = req.userId || 'demo-user';
        const { id } = req.params;
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({ success: false, error: 'Note content is required' });
        }

        const { data, error } = await supabase
            .from('user_notes')
            .update({
                content,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            logger.error('Error updating note', { error, id, userId });
            return res.status(500).json({ success: false, error: 'Failed to update note' });
        }

        res.json({ success: true, data });
    } catch (error: any) {
        logger.error('Unexpected error in PATCH /api/notes', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
