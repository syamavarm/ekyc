/**
 * Admin Routes for Workflow Configuration
 * Routes for managing KYC workflow configurations
 */

import express from 'express';
import { WorkflowConfigManager } from '../services/workflowConfigManager';
import { 
  CreateWorkflowRequest, 
  CreateWorkflowResponse,
  GetWorkflowResponse 
} from '../types/kyc.types';

const router = express.Router();
const workflowConfigManager = new WorkflowConfigManager();

// Export the workflow config manager for use in other routes
export { workflowConfigManager };

/**
 * POST /admin/workflow/create
 * Create a new workflow configuration
 */
router.post('/workflow/create', (req, res) => {
  try {
    const { name, steps, formId, createdBy }: CreateWorkflowRequest = req.body;

    // Validate required fields
    if (!name || !steps) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Name and steps are required',
      });
    }

    // Create the configuration
    const configuration = workflowConfigManager.createConfiguration(
      name,
      steps,
      formId,
      createdBy
    );

    // Generate the KYC link
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const linkUrl = workflowConfigManager.generateKYCLink(configuration.configId, baseUrl);

    const response: CreateWorkflowResponse = {
      success: true,
      configId: configuration.configId,
      linkUrl: linkUrl || '',
      message: 'Workflow configuration created successfully',
    };

    res.status(201).json(response);
  } catch (error: any) {
    console.error('Error creating workflow configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /admin/workflow/:configId
 * Get a specific workflow configuration
 */
router.get('/workflow/:configId', (req, res) => {
  try {
    const { configId } = req.params;

    const configuration = workflowConfigManager.getConfiguration(configId);

    if (!configuration) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
        message: `No configuration found with ID: ${configId}`,
      });
    }

    const response: GetWorkflowResponse = {
      success: true,
      configuration,
    };

    res.json(response);
  } catch (error: any) {
    console.error('Error fetching workflow configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /admin/workflows
 * Get all workflow configurations
 */
router.get('/workflows', (req, res) => {
  try {
    const configurations = workflowConfigManager.getAllConfigurations();

    res.json({
      success: true,
      configurations,
      count: configurations.length,
    });
  } catch (error: any) {
    console.error('Error fetching workflow configurations:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /admin/workflows/active
 * Get all active workflow configurations
 */
router.get('/workflows/active', (req, res) => {
  try {
    const configurations = workflowConfigManager.getActiveConfigurations();

    res.json({
      success: true,
      configurations,
      count: configurations.length,
    });
  } catch (error: any) {
    console.error('Error fetching active workflow configurations:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * PUT /admin/workflow/:configId
 * Update a workflow configuration
 */
router.put('/workflow/:configId', (req, res) => {
  try {
    const { configId } = req.params;
    const updates = req.body;

    const success = workflowConfigManager.updateConfiguration(configId, updates);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
        message: `No configuration found with ID: ${configId}`,
      });
    }

    const configuration = workflowConfigManager.getConfiguration(configId);

    res.json({
      success: true,
      configuration,
      message: 'Configuration updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating workflow configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * POST /admin/workflow/:configId/deactivate
 * Deactivate a workflow configuration
 */
router.post('/workflow/:configId/deactivate', (req, res) => {
  try {
    const { configId } = req.params;

    const success = workflowConfigManager.deactivateConfiguration(configId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
        message: `No configuration found with ID: ${configId}`,
      });
    }

    res.json({
      success: true,
      message: 'Configuration deactivated successfully',
    });
  } catch (error: any) {
    console.error('Error deactivating workflow configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * POST /admin/workflow/:configId/activate
 * Activate a workflow configuration
 */
router.post('/workflow/:configId/activate', (req, res) => {
  try {
    const { configId } = req.params;

    const success = workflowConfigManager.activateConfiguration(configId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
        message: `No configuration found with ID: ${configId}`,
      });
    }

    res.json({
      success: true,
      message: 'Configuration activated successfully',
    });
  } catch (error: any) {
    console.error('Error activating workflow configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * DELETE /admin/workflow/:configId
 * Delete a workflow configuration
 */
router.delete('/workflow/:configId', (req, res) => {
  try {
    const { configId } = req.params;

    const success = workflowConfigManager.deleteConfiguration(configId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found',
        message: `No configuration found with ID: ${configId}`,
      });
    }

    res.json({
      success: true,
      message: 'Configuration deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting workflow configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /admin/workflow/:configId/validate
 * Validate a workflow configuration
 */
router.get('/workflow/:configId/validate', (req, res) => {
  try {
    const { configId } = req.params;

    const validation = workflowConfigManager.validateConfiguration(configId);

    res.json({
      success: validation.isValid,
      validation,
    });
  } catch (error: any) {
    console.error('Error validating workflow configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /admin/statistics
 * Get workflow configuration statistics
 */
router.get('/statistics', (req, res) => {
  try {
    const statistics = workflowConfigManager.getStatistics();

    res.json({
      success: true,
      statistics,
    });
  } catch (error: any) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

export default router;

