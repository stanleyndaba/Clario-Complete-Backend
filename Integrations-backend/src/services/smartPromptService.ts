import { supabase } from '../database/supabaseClient';
import sseHub from '../utils/sseHub';

export interface PromptOption {
  id: string; // internal option id
  label: string;
  evidence_document_id: string;
}

export const smartPromptService = {
  async createEvidenceSelectionPrompt(sellerId: string, disputeId: string | null, question: string, options: PromptOption[]): Promise<string> {
    const { data, error } = await supabase
      .from('smart_prompts')
      .insert({
        seller_id: sellerId,
        status: 'open',
        prompt_type: 'evidence_selection',
        question,
        options: options.map(o => ({ id: o.id, label: o.label, evidence_document_id: o.evidence_document_id })),
        related_dispute_id: disputeId
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create smart prompt: ${error.message}`);

    // Notify frontend via SSE
    sseHub.sendEvent(sellerId, 'smart_prompt', {
      type: 'smart_prompt',
      promptId: data.id,
      question,
      options
    });

    return data.id as string;
  },

  async answerPrompt(sellerId: string, promptId: string, selectedOptionId: string): Promise<void> {
    await supabase
      .from('smart_prompts')
      .update({ status: 'answered', selected_option_id: selectedOptionId, answered_at: new Date().toISOString() })
      .eq('id', promptId)
      .eq('seller_id', sellerId);
  }
};

export default smartPromptService;


