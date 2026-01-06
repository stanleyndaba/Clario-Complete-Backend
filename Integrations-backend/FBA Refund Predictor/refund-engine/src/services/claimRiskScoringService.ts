/**
 * Claim Risk Scoring Service
 * Integrates with Python ML models for claim success probability and refund timeline prediction
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface ClaimRiskFeatures {
  discrepancy_type: string;
  discrepancy_size: number;
  days_outstanding: number;
  marketplace: string;
  historical_payout_rate: number;
}

export interface ClaimRiskScore {
  success_probability: number;
  refund_timeline_days: number;
  confidence_score: number;
  risk_level: 'Low' | 'Medium' | 'High';
  model_version: string;
  features_used: string[];
}

export interface ModelInfo {
  is_trained: boolean;
  models_dir: string;
  success_model_type: string | null;
  timeline_model_type: string | null;
  categorical_features: string[];
  numerical_features: string[];
}

export interface TrainingMetrics {
  success_accuracy: number;
  success_auc: number;
  timeline_rmse: number;
  timeline_r2: number;
}

export class ClaimRiskScoringService {
  private pythonScriptPath: string;
  private modelsDir: string;

  constructor() {
    this.pythonScriptPath = path.join(__dirname, 'certainty_engine.py');
    this.modelsDir = path.join(process.cwd(), 'models');
    
    // Ensure models directory exists
    if (!fs.existsSync(this.modelsDir)) {
      fs.mkdirSync(this.modelsDir, { recursive: true });
    }
  }

  /**
   * Score a claim using the Python ML models
   */
  async scoreClaim(features: ClaimRiskFeatures): Promise<ClaimRiskScore> {
    try {
      const result = await this.runPythonScript('score_claim', features);
      return result as ClaimRiskScore;
    } catch (error) {
      console.error('Error scoring claim:', error);
      throw new Error(`Failed to score claim: ${error}`);
    }
  }

  /**
   * Train the ML models with synthetic data
   */
  async trainModels(nSamples: number = 10000): Promise<TrainingMetrics> {
    try {
      const result = await this.runPythonScript('train_models', { n_samples: nSamples });
      return result as TrainingMetrics;
    } catch (error) {
      console.error('Error training models:', error);
      throw new Error(`Failed to train models: ${error}`);
    }
  }

  /**
   * Get information about the trained models
   */
  async getModelInfo(): Promise<ModelInfo> {
    try {
      const result = await this.runPythonScript('get_model_info', {});
      return result as ModelInfo;
    } catch (error) {
      console.error('Error getting model info:', error);
      throw new Error(`Failed to get model info: ${error}`);
    }
  }

  /**
   * Run Python script with given function and arguments
   */
  private async runPythonScript(
    functionName: string, 
    args: any
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn('python', [
        this.pythonScriptPath,
        '--function', functionName,
        '--args', JSON.stringify(args)
      ]);

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            // Parse the JSON response from Python
            const lines = stdout.trim().split('\n');
            const jsonLine = lines.find(line => line.startsWith('JSON_RESULT:'));
            
            if (jsonLine) {
              const jsonStr = jsonLine.replace('JSON_RESULT:', '').trim();
              const result = JSON.parse(jsonStr);
              resolve(result);
            } else {
              reject(new Error('No JSON result found in Python output'));
            }
          } catch (parseError) {
            reject(new Error(`Failed to parse Python output: ${parseError}`));
          }
        } else {
          reject(new Error(`Python script failed with code ${code}: ${stderr}`));
        }
      });

      pythonProcess.on('error', (error) => {
        reject(new Error(`Failed to start Python process: ${error}`));
      });
    });
  }

  /**
   * Check if Python and required packages are available
   */
  async checkPythonEnvironment(): Promise<boolean> {
    try {
      const result = await this.runPythonScript('check_environment', {});
      return result.available === true;
    } catch (error) {
      console.error('Python environment check failed:', error);
      return false;
    }
  }

  /**
   * Get a sample claim for testing
   */
  getSampleClaim(): ClaimRiskFeatures {
    return {
      discrepancy_type: 'missing_refund',
      discrepancy_size: 150.0,
      days_outstanding: 45,
      marketplace: 'amazon',
      historical_payout_rate: 0.75
    };
  }

  /**
   * Validate claim features
   */
  validateClaimFeatures(features: any): features is ClaimRiskFeatures {
    const required = ['discrepancy_type', 'discrepancy_size', 'days_outstanding', 'marketplace', 'historical_payout_rate'];
    
    for (const field of required) {
      if (!(field in features)) {
        return false;
      }
    }

    // Type validation
    if (typeof features.discrepancy_type !== 'string') return false;
    if (typeof features.discrepancy_size !== 'number' || features.discrepancy_size <= 0) return false;
    if (typeof features.days_outstanding !== 'number' || features.days_outstanding < 0) return false;
    if (typeof features.marketplace !== 'string') return false;
    if (typeof features.historical_payout_rate !== 'number' || features.historical_payout_rate < 0 || features.historical_payout_rate > 1) return false;

    return true;
  }
}

// Export singleton instance
export const claimRiskScoringService = new ClaimRiskScoringService();



