/**
 * Workflow Configuration Manager
 * Manages admin-created workflow configurations and generates unique KYC session links
 */

import { WorkflowConfiguration, WorkflowSteps } from '../types/kyc.types';
import { v4 as uuidv4 } from 'uuid';

export class WorkflowConfigManager {
  private configurations: Map<string, WorkflowConfiguration>;

  constructor() {
    this.configurations = new Map();
  }

  /**
   * Create a new workflow configuration
   */
  createConfiguration(
    name: string,
    steps: WorkflowSteps,
    formId?: string,
    createdBy?: string
  ): WorkflowConfiguration {
    const configId = uuidv4();
    
    const configuration: WorkflowConfiguration = {
      configId,
      name,
      steps,
      formId,
      createdAt: new Date(),
      createdBy,
      isActive: true,
    };
    
    this.configurations.set(configId, configuration);
    console.log(`[WorkflowConfigManager] Configuration created: ${configId}`);
    
    return configuration;
  }

  /**
   * Get configuration by ID
   */
  getConfiguration(configId: string): WorkflowConfiguration | undefined {
    return this.configurations.get(configId);
  }

  /**
   * Get all configurations
   */
  getAllConfigurations(): WorkflowConfiguration[] {
    return Array.from(this.configurations.values());
  }

  /**
   * Get active configurations only
   */
  getActiveConfigurations(): WorkflowConfiguration[] {
    return Array.from(this.configurations.values()).filter(
      config => config.isActive
    );
  }

  /**
   * Update configuration
   */
  updateConfiguration(
    configId: string,
    updates: Partial<Omit<WorkflowConfiguration, 'configId' | 'createdAt'>>
  ): boolean {
    const config = this.configurations.get(configId);
    if (!config) return false;

    const updatedConfig = {
      ...config,
      ...updates,
    };

    this.configurations.set(configId, updatedConfig);
    console.log(`[WorkflowConfigManager] Configuration updated: ${configId}`);
    
    return true;
  }

  /**
   * Deactivate configuration
   */
  deactivateConfiguration(configId: string): boolean {
    return this.updateConfiguration(configId, { isActive: false });
  }

  /**
   * Activate configuration
   */
  activateConfiguration(configId: string): boolean {
    return this.updateConfiguration(configId, { isActive: true });
  }

  /**
   * Delete configuration
   */
  deleteConfiguration(configId: string): boolean {
    const deleted = this.configurations.delete(configId);
    if (deleted) {
      console.log(`[WorkflowConfigManager] Configuration deleted: ${configId}`);
    }
    return deleted;
  }

  /**
   * Generate KYC link for a configuration
   */
  generateKYCLink(configId: string, baseUrl: string): string | null {
    const config = this.configurations.get(configId);
    if (!config) return null;

    // Generate link that includes the config ID
    const link = `${baseUrl}/kyc/${configId}`;
    
    console.log(`[WorkflowConfigManager] Generated link for config ${configId}: ${link}`);
    
    return link;
  }

  /**
   * Validate configuration
   */
  validateConfiguration(configId: string): {
    isValid: boolean;
    errors: string[];
  } {
    const config = this.configurations.get(configId);
    const errors: string[] = [];

    if (!config) {
      errors.push('Configuration not found');
      return { isValid: false, errors };
    }

    if (!config.isActive) {
      errors.push('Configuration is not active');
    }

    // Check if at least one step is enabled
    const hasEnabledStep = Object.values(config.steps).some(step => step === true);
    if (!hasEnabledStep) {
      errors.push('At least one workflow step must be enabled');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    total: number;
    active: number;
    inactive: number;
  } {
    const configs = Array.from(this.configurations.values());
    
    return {
      total: configs.length,
      active: configs.filter(c => c.isActive).length,
      inactive: configs.filter(c => !c.isActive).length,
    };
  }
}

