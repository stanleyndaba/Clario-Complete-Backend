import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/waitlist
 * Register a new user for the waitlist
 */
router.post('/', async (req: Request, res: Response) => {
    const {
        email,
        user_type,
        brand_count,
        annual_revenue,
        contact_handle,
        primary_goal,
        // Legacy fields (optional)
        full_name,
        company_name,
        monthly_volume,
        referral_source
    } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            message: 'Email is required'
        });
    }

    try {
        logger.info('📝 [WAITLIST] New "Velvet Rope" signup request', { email, user_type, annual_revenue });

        // Sorting Logic (Scenario A: Agency + $10M+)
        const isWhale = (user_type === 'agency' && annual_revenue === 'enterprise') || annual_revenue === 'enterprise';
        const priority = isWhale ? 'high' : 'standard';

        // Insert into waitlist table using admin client to bypass RLS
        const { data, error } = await supabaseAdmin
            .from('waitlist')
            .insert({
                email,
                user_type,
                brand_count: brand_count || null,
                annual_revenue,
                contact_handle: contact_handle || null,
                primary_goal,
                // Legacy fields mapping
                full_name: full_name || null,
                company_name: company_name || null,
                monthly_volume: annual_revenue || monthly_volume || null,
                referral_source: referral_source || null,
                status: 'pending',
                metadata: {
                    signup_at: new Date().toISOString(),
                    user_agent: req.headers['user-agent'],
                    ip: req.ip,
                    priority,
                    is_whale: isWhale,
                    redesign_version: 'velvet_rope_v1'
                }
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique violation
                logger.info('📝 [WAITLIST] Email already registered', { email });
                return res.status(200).json({
                    success: true,
                    message: 'You are already on the waitlist! We will notify you when a spot opens up.',
                    already_registered: true
                });
            }

            logger.error('❌ [WAITLIST] Database error', { error: error.message, email });
            throw error;
        }

        logger.info('✅ [WAITLIST] Successfully registered email', { email, id: data.id });

        return res.status(201).json({
            success: true,
            message: 'Welcome to the waitlist! We will be in touch soon.',
            data
        });
    } catch (error: any) {
        logger.error('❌ [WAITLIST] Server error', { error: error.message, email });
        return res.status(500).json({
            success: false,
            message: 'Failed to join the waitlist. Please try again later.'
        });
    }
});

export default router;
