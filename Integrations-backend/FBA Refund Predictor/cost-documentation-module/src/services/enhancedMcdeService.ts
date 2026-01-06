import axios from 'axios';
import { logger } from '../utils/logger';
import { S3Service } from './s3Service';

export interface EnhancedMCDERequest {
  documentId: string;
  fileKey: string;
  claimId: string;
  skuId: string;
  processingOptions?: {
    ocr_engine?: 'paddle' | 'tesseract' | 'aws_textract';
    ner_model?: 'spacy' | 'transformers' | 'custom';
    layout_analysis?: boolean;
    confidence_threshold?: number;
    max_retries?: number;
  };
}

export interface EnhancedMCDEResponse {
  documentId: string;
  extractedData: {
    [key: string]: {
      value: any;
      confidence: number;
      source: 'ocr' | 'ner' | 'layout' | 'cross_reference';
      validation_status: 'validated' | 'pending' | 'failed';
    };
  };
  evidenceQuality: {
    overall_confidence: number;
    completeness_score: number;
    consistency_score: number;
    reliability_score: number;
    validation_status: 'high' | 'medium' | 'low';
  };
  processingMetadata: {
    ocr_engine_used: string;
    ner_model_used: string;
    layout_analysis_performed: boolean;
    processing_time_ms: number;
    validation_steps_completed: number;
  };
  processingStatus: 'completed' | 'failed' | 'processing';
  error?: string;
}

export interface EvidenceValidationResult {
  field: string;
  value: any;
  confidence: number;
  validation_methods: string[];
  cross_reference_score: number;
  business_rule_compliance: boolean;
  final_status: 'validated' | 'pending' | 'failed';
}

export interface BusinessRule {
  field: string;
  rule_type: 'range' | 'format' | 'regex' | 'cross_field' | 'custom';
  rule_definition: any;
  error_message: string;
}

export class EnhancedMCDEService {
  private static baseUrl = process.env.MCDE_API_BASE_URL || 'http://localhost:8000';
  private static timeout = parseInt(process.env.MCDE_API_TIMEOUT || '60000'); // 60 seconds for enhanced processing
  private static s3Service: S3Service;

  // Business rules for evidence validation
  private static businessRules: BusinessRule[] = [
    {
      field: 'amount',
      rule_type: 'range',
      rule_definition: { min: 0.01, max: 100000 },
      error_message: 'Amount must be between $0.01 and $100,000'
    },
    {
      field: 'invoice_number',
      rule_type: 'regex',
      rule_definition: /^[A-Z0-9\-_]{3,20}$/,
      error_message: 'Invoice number must be 3-20 characters, alphanumeric with hyphens/underscores'
    },
    {
      field: 'date',
      rule_type: 'format',
      rule_definition: /^\d{4}-\d{2}-\d{2}$/,
      error_message: 'Date must be in YYYY-MM-DD format'
    },
    {
      field: 'vendor_name',
      rule_type: 'regex',
      rule_definition: /^[A-Za-z0-9\s&.,'-]{2,100}$/,
      error_message: 'Vendor name must be 2-100 characters, alphanumeric with common punctuation'
    }
  ];

  /**
   * Enhanced document processing with multi-modal extraction and validation
   */
  static async processDocumentEnhanced(request: EnhancedMCDERequest): Promise<EnhancedMCDEResponse> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting enhanced MCDE processing', {
        documentId: request.documentId,
        claimId: request.claimId,
        skuId: request.skuId,
        options: request.processingOptions
      });

      // Step 1: Multi-modal document processing
      const extractionResults = await this.performMultiModalExtraction(request);
      
      // Step 2: Evidence validation and confidence scoring
      const validationResults = await this.validateEvidence(extractionResults, request);
      
      // Step 3: Quality assessment
      const qualityAssessment = this.assessEvidenceQuality(validationResults);
      
      // Step 4: Cross-reference validation
      const crossReferenceResults = await this.performCrossReferenceValidation(
        validationResults, request.claimId
      );
      
      // Step 5: Final evidence compilation
      const finalEvidence = this.compileFinalEvidence(
        validationResults, crossReferenceResults, qualityAssessment
      );

      const processingTime = Date.now() - startTime;

      logger.info('Enhanced MCDE processing completed', {
        documentId: request.documentId,
        overallConfidence: qualityAssessment.overall_confidence,
        processingTime,
        validationSteps: qualityAssessment.validation_steps_completed
      });

      return {
        documentId: request.documentId,
        extractedData: finalEvidence,
        evidenceQuality: qualityAssessment,
        processingMetadata: {
          ocr_engine_used: request.processingOptions?.ocr_engine || 'paddle',
          ner_model_used: request.processingOptions?.ner_model || 'spacy',
          layout_analysis_performed: request.processingOptions?.layout_analysis || true,
          processing_time_ms: processingTime,
          validation_steps_completed: qualityAssessment.validation_steps_completed
        },
        processingStatus: 'completed'
      };

    } catch (error) {
      logger.error('Enhanced MCDE processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        documentId: request.documentId,
        claimId: request.claimId
      });

      return {
        documentId: request.documentId,
        extractedData: {},
        evidenceQuality: {
          overall_confidence: 0,
          completeness_score: 0,
          consistency_score: 0,
          reliability_score: 0,
          validation_status: 'low'
        },
        processingMetadata: {
          ocr_engine_used: 'unknown',
          ner_model_used: 'unknown',
          layout_analysis_performed: false,
          processing_time_ms: Date.now() - startTime,
          validation_steps_completed: 0
        },
        processingStatus: 'failed',
        error: error instanceof Error ? error.message : 'Processing failed'
      };
    }
  }

  /**
   * Perform multi-modal document extraction using OCR, NER, and layout analysis
   */
  private static async performMultiModalExtraction(request: EnhancedMCDERequest): Promise<any> {
    const extractionRequest = {
      document_id: request.documentId,
      file_key: request.fileKey,
      claim_id: request.claimId,
      sku_id: request.skuId,
      processing_options: {
        ocr_engine: request.processingOptions?.ocr_engine || 'paddle',
        ner_model: request.processingOptions?.ner_model || 'spacy',
        layout_analysis: request.processingOptions?.layout_analysis || true,
        confidence_threshold: request.processingOptions?.confidence_threshold || 0.8,
        max_retries: request.processingOptions?.max_retries || 3
      }
    };

    const response = await axios.post(
      `${this.baseUrl}/enhanced-extract`,
      extractionRequest,
      {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.MCDE_API_KEY || ''}`,
        },
      }
    );

    return response.data;
  }

  /**
   * Validate extracted evidence using multiple validation methods
   */
  private static async validateEvidence(extractionResults: any, request: EnhancedMCDERequest): Promise<EvidenceValidationResult[]> {
    const validationResults: EvidenceValidationResult[] = [];

    for (const [field, extractionData] of Object.entries(extractionResults.extracted_data || {})) {
      const validationResult = await this.validateField(field, extractionData, request);
      validationResults.push(validationResult);
    }

    return validationResults;
  }

  /**
   * Validate individual field using multiple validation methods
   */
  private static async validateField(field: string, extractionData: any, request: EnhancedMCDERequest): Promise<EvidenceValidationResult> {
    const validationMethods: string[] = [];
    let crossReferenceScore = 0;
    let businessRuleCompliance = true;

    // Method 1: OCR confidence validation
    if (extractionData.ocr_confidence && extractionData.ocr_confidence > 0.8) {
      validationMethods.push('ocr_confidence');
      crossReferenceScore += 0.3;
    }

    // Method 2: NER confidence validation
    if (extractionData.ner_confidence && extractionData.ner_confidence > 0.8) {
      validationMethods.push('ner_confidence');
      crossReferenceScore += 0.3;
    }

    // Method 3: Layout analysis validation
    if (extractionData.layout_confidence && extractionData.layout_confidence > 0.8) {
      validationMethods.push('layout_analysis');
      crossReferenceScore += 0.2;
    }

    // Method 4: Business rule validation
    const businessRule = this.businessRules.find(rule => rule.field === field);
    if (businessRule) {
      const ruleCompliance = this.validateBusinessRule(extractionData.value, businessRule);
      if (ruleCompliance) {
        validationMethods.push('business_rule');
        crossReferenceScore += 0.2;
      } else {
        businessRuleCompliance = false;
      }
    }

    // Method 5: Cross-field consistency validation
    const consistencyCheck = await this.checkCrossFieldConsistency(field, extractionData.value, request.claimId);
    if (consistencyCheck.isConsistent) {
      validationMethods.push('cross_field_consistency');
      crossReferenceScore += 0.2;
    }

    // Calculate overall confidence
    const confidence = Math.min(1.0, crossReferenceScore + (extractionData.confidence || 0) * 0.5);

    // Determine final status
    let finalStatus: 'validated' | 'pending' | 'failed' = 'pending';
    if (confidence >= 0.8 && businessRuleCompliance) {
      finalStatus = 'validated';
    } else if (confidence < 0.5 || !businessRuleCompliance) {
      finalStatus = 'failed';
    }

    return {
      field,
      value: extractionData.value,
      confidence,
      validation_methods: validationMethods,
      cross_reference_score: crossReferenceScore,
      business_rule_compliance: businessRuleCompliance,
      final_status: finalStatus
    };
  }

  /**
   * Validate business rules for extracted data
   */
  private static validateBusinessRule(value: any, rule: BusinessRule): boolean {
    switch (rule.rule_type) {
      case 'range':
        const numValue = parseFloat(value);
        return !isNaN(numValue) && 
               numValue >= rule.rule_definition.min && 
               numValue <= rule.rule_definition.max;

      case 'format':
        return rule.rule_definition.test(value);

      case 'regex':
        return rule.rule_definition.test(value);

      case 'cross_field':
        // Implement cross-field validation logic
        return true;

      case 'custom':
        // Implement custom validation logic
        return true;

      default:
        return true;
    }
  }

  /**
   * Check cross-field consistency with existing claim data
   */
  private static async checkCrossFieldConsistency(field: string, value: any, claimId: string): Promise<{ isConsistent: boolean; confidence: number }> {
    try {
      // Query existing claim data for consistency check
      const response = await axios.get(
        `${this.baseUrl}/claim-consistency-check`,
        {
          params: { claim_id: claimId, field, value },
          timeout: 10000
        }
      );

      return {
        isConsistent: response.data.is_consistent,
        confidence: response.data.confidence || 0
      };
    } catch (error) {
      logger.warn('Cross-field consistency check failed', { field, claimId, error });
      return { isConsistent: true, confidence: 0.5 }; // Default to consistent if check fails
    }
  }

  /**
   * Perform cross-reference validation with external data sources
   */
  private static async performCrossReferenceValidation(validationResults: EvidenceValidationResult[], claimId: string): Promise<any> {
    const crossReferenceResults: any = {};

    for (const result of validationResults) {
      if (result.final_status === 'validated') {
        // Perform additional cross-reference checks
        const crossRefResult = await this.performExternalCrossReference(result.field, result.value, claimId);
        crossReferenceResults[result.field] = crossRefResult;
      }
    }

    return crossReferenceResults;
  }

  /**
   * Perform external cross-reference validation
   */
  private static async performExternalCrossReference(field: string, value: any, claimId: string): Promise<any> {
    try {
      // Example: Cross-reference with Amazon SP-API data
      const response = await axios.post(
        `${this.baseUrl}/external-cross-reference`,
        {
          field,
          value,
          claim_id: claimId,
          data_sources: ['amazon_sp_api', 'internal_database', 'vendor_records']
        },
        { timeout: 15000 }
      );

      return {
        external_validation: response.data.validation_result,
        external_confidence: response.data.confidence,
        data_sources_checked: response.data.sources_checked
      };
    } catch (error) {
      logger.warn('External cross-reference failed', { field, claimId, error });
      return {
        external_validation: 'unknown',
        external_confidence: 0.5,
        data_sources_checked: []
      };
    }
  }

  /**
   * Assess overall evidence quality
   */
  private static assessEvidenceQuality(validationResults: EvidenceValidationResult[]): any {
    const validatedFields = validationResults.filter(r => r.final_status === 'validated');
    const totalFields = validationResults.length;

    // Calculate completeness score
    const completenessScore = totalFields > 0 ? validatedFields.length / totalFields : 0;

    // Calculate consistency score
    const consistencyScores = validationResults.map(r => r.cross_reference_score);
    const consistencyScore = consistencyScores.length > 0 ? 
      consistencyScores.reduce((a, b) => a + b, 0) / consistencyScores.length : 0;

    // Calculate reliability score
    const reliabilityScores = validationResults.map(r => r.confidence);
    const reliabilityScore = reliabilityScores.length > 0 ? 
      reliabilityScores.reduce((a, b) => a + b, 0) / reliabilityScores.length : 0;

    // Calculate overall confidence
    const overallConfidence = (completenessScore + consistencyScore + reliabilityScore) / 3;

    // Determine validation status
    let validationStatus: 'high' | 'medium' | 'low' = 'low';
    if (overallConfidence >= 0.8) {
      validationStatus = 'high';
    } else if (overallConfidence >= 0.6) {
      validationStatus = 'medium';
    }

    return {
      overall_confidence: overallConfidence,
      completeness_score: completenessScore,
      consistency_score: consistencyScore,
      reliability_score: reliabilityScore,
      validation_status: validationStatus,
      validation_steps_completed: validationResults.length
    };
  }

  /**
   * Compile final evidence with validation results
   */
  private static compileFinalEvidence(
    validationResults: EvidenceValidationResult[],
    crossReferenceResults: any,
    qualityAssessment: any
  ): any {
    const finalEvidence: any = {};

    for (const result of validationResults) {
      finalEvidence[result.field] = {
        value: result.value,
        confidence: result.confidence,
        source: this.determineEvidenceSource(result.validation_methods),
        validation_status: result.final_status,
        cross_reference: crossReferenceResults[result.field] || null
      };
    }

    return finalEvidence;
  }

  /**
   * Determine evidence source based on validation methods
   */
  private static determineEvidenceSource(validationMethods: string[]): 'ocr' | 'ner' | 'layout' | 'cross_reference' {
    if (validationMethods.includes('cross_field_consistency')) {
      return 'cross_reference';
    } else if (validationMethods.includes('layout_analysis')) {
      return 'layout';
    } else if (validationMethods.includes('ner_confidence')) {
      return 'ner';
    } else {
      return 'ocr';
    }
  }

  /**
   * Get evidence quality metrics for a claim
   */
  static async getEvidenceQualityMetrics(claimId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/evidence-quality-metrics`,
        {
          params: { claim_id: claimId },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to get evidence quality metrics', { claimId, error });
      throw new Error('Failed to retrieve evidence quality metrics');
    }
  }

  /**
   * Retrain evidence validation models with feedback
   */
  static async retrainValidationModels(feedbackData: any[]): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/retrain-validation-models`,
        { feedback_data: feedbackData },
        {
          timeout: 300000, // 5 minutes for retraining
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MCDE_API_KEY || ''}`,
          },
        }
      );

      logger.info('Validation models retrained successfully', {
        feedback_samples: feedbackData.length,
        new_accuracy: response.data.new_accuracy
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to retrain validation models', { error });
      throw new Error('Failed to retrain validation models');
    }
  }

  /**
   * Get processing statistics
   */
  static async getProcessingStatistics(): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/processing-statistics`,
        { timeout: 10000 }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to get processing statistics', { error });
      return {
        total_processed: 0,
        success_rate: 0,
        average_confidence: 0,
        average_processing_time: 0
      };
    }
  }
}




