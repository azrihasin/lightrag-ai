import { Injectable } from '@nestjs/common';
import {
  getCatalogComponent,
  requiredFieldsFor,
} from '../../ai/mastra/visualization/catalog-descriptor';
import type { VisualizationSpec } from '../analytics.types';

/** Script-injection prop names that must never appear in a compiled spec. */
const FORBIDDEN_KEYS = new Set([
  'onClick', 'onLoad', 'onError', 'script', 'eval', 'innerHTML',
  'dangerouslySetInnerHTML', '__html', 'href', 'src', 'action', 'formAction',
]);

export interface VizJsonValidation {
  valid: boolean;
  reasons: string[];
}

/**
 * Validates a DuckDB-compiled {@link VisualizationSpec} before it reaches the
 * frontend: the component must be a known catalog entry, the canonical required
 * fields for its kind must be present, and no injection-prone keys may appear.
 * Inline `data` arrays are expected here (the chat render contract), unlike the
 * deprecated dataState model.
 */
@Injectable()
export class VizJsonValidator {
  validate(spec: VisualizationSpec): VizJsonValidation {
    const reasons: string[] = [];

    const comp = getCatalogComponent(spec.componentType);
    if (!comp) {
      reasons.push(`Unknown catalog component "${spec.componentType}".`);
      return { valid: false, reasons };
    }

    const props = spec.props ?? {};
    for (const field of requiredFieldsFor(comp.kind)) {
      if (props[field] == null) reasons.push(`Missing required field "${field}" for ${comp.kind}.`);
    }

    this.scanForbidden(props, '', reasons);

    return { valid: reasons.length === 0, reasons };
  }

  private scanForbidden(node: unknown, path: string, reasons: string[]): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      // Data rows are allowed; only recurse into nested objects to catch keys.
      for (const item of node) this.scanForbidden(item, path, reasons);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.has(key)) {
        reasons.push(`Forbidden key "${path ? `${path}.${key}` : key}" — potential injection.`);
        continue;
      }
      this.scanForbidden(value, path ? `${path}.${key}` : key, reasons);
    }
  }
}
