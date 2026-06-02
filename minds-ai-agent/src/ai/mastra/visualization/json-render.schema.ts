import { Injectable } from '@nestjs/common';
import { isAllowedComponent, COMPONENT_ALLOWLIST_SET } from './component-allowlist';

export type JsonRenderSpecValidationResult = {
  valid: boolean;
  reasons: string[];
  repairedSpec?: Record<string, unknown>;
};

// Script injection field names that must never appear in a spec
const FORBIDDEN_SPEC_KEYS = new Set([
  'onClick', 'onLoad', 'onError', 'script', 'eval', 'innerHTML', 'dangerouslySetInnerHTML',
  '__html', 'href', 'src', 'action', 'formAction',
]);

@Injectable()
export class JsonRenderSchemaService {
  validate(spec: unknown): JsonRenderSpecValidationResult {
    const reasons: string[] = [];

    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      return { valid: false, reasons: ['spec must be a non-null object'] };
    }

    const obj = spec as Record<string, unknown>;

    this.checkNode(obj, reasons, '');

    return {
      valid: reasons.length === 0,
      reasons,
    };
  }

  private checkNode(node: Record<string, unknown>, reasons: string[], path: string): void {
    // Check component type
    if ('type' in node || 'component' in node) {
      const componentName = (node['type'] ?? node['component']) as string;
      if (typeof componentName === 'string' && !isAllowedComponent(componentName)) {
        reasons.push(`Component "${componentName}" at "${path || 'root'}" is not in allowlist (${[...COMPONENT_ALLOWLIST_SET].join(', ')})`);
      }
    }

    for (const [key, value] of Object.entries(node)) {
      const keyPath = path ? `${path}.${key}` : key;

      // Block injection fields
      if (FORBIDDEN_SPEC_KEYS.has(key)) {
        reasons.push(`Forbidden spec key "${keyPath}" — potential injection`);
        continue;
      }

      // Block inline row arrays in spec (data must come from dataState only)
      if (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'object' && item !== null)) {
        reasons.push(`Inline data array at "${keyPath}" — data must reference dataState paths (e.g., $.series), not embed rows`);
        continue;
      }

      // Recurse into children/props
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.checkNode(value as Record<string, unknown>, reasons, keyPath);
      }

      // Recurse into arrays of spec nodes (e.g., children, items)
      if (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'object' && item !== null)) {
        // Already blocked above — inline data arrays
      }
    }
  }

  /** Returns a repaired spec with forbidden components replaced by 'Text' nodes. */
  repair(spec: Record<string, unknown>): Record<string, unknown> {
    return this.repairNode(spec);
  }

  private repairNode(node: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_SPEC_KEYS.has(key)) continue; // strip injection fields

      if ((key === 'type' || key === 'component') && typeof value === 'string') {
        result[key] = isAllowedComponent(value) ? value : 'Text';
        continue;
      }

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.repairNode(value as Record<string, unknown>);
        continue;
      }

      // Strip inline data arrays from spec
      if (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'object' && item !== null)) {
        result[key] = '$.placeholder';
        continue;
      }

      result[key] = value;
    }

    return result;
  }
}
