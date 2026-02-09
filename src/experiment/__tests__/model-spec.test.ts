import { describe, it, expect } from 'vitest';
import {
  parseModelSpec,
  inferProvider,
  specToModelConfig,
  parseModelConfigFromSpec,
  parsePowerAssignments,
} from '../model-spec';

describe('parseModelSpec', () => {
  describe('explicit provider prefix', () => {
    it('should parse openai:model', () => {
      const result = parseModelSpec('openai:gpt-4o');
      expect(result).toEqual({
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: undefined,
        apiKey: undefined,
        raw: 'openai:gpt-4o',
      });
    });

    it('should parse anthropic:model', () => {
      const result = parseModelSpec('anthropic:claude-sonnet-4-5-20250929');
      expect(result).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
        baseUrl: undefined,
        apiKey: undefined,
        raw: 'anthropic:claude-sonnet-4-5-20250929',
      });
    });

    it('should parse claude: alias as anthropic', () => {
      const result = parseModelSpec('claude:claude-sonnet-4-5-20250929');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('should parse openrouter:org/model', () => {
      const result = parseModelSpec('openrouter:openai/gpt-4o');
      expect(result).toEqual({
        provider: 'openrouter',
        model: 'openai/gpt-4o',
        baseUrl: undefined,
        apiKey: undefined,
        raw: 'openrouter:openai/gpt-4o',
      });
    });

    it('should parse ollama:model', () => {
      const result = parseModelSpec('ollama:llama3.2');
      expect(result).toEqual({
        provider: 'ollama',
        model: 'llama3.2',
        baseUrl: undefined,
        apiKey: undefined,
        raw: 'ollama:llama3.2',
      });
    });

    it('should parse custom:model', () => {
      const result = parseModelSpec('custom:mymodel');
      expect(result.provider).toBe('custom');
      expect(result.model).toBe('mymodel');
    });

    it('should parse local: alias as custom', () => {
      const result = parseModelSpec('local:mymodel');
      expect(result.provider).toBe('custom');
      expect(result.model).toBe('mymodel');
    });

    it('should parse mock:mock', () => {
      const result = parseModelSpec('mock:mock');
      expect(result.provider).toBe('mock');
      expect(result.model).toBe('mock');
    });
  });

  describe('base URL extraction', () => {
    it('should extract base URL with @', () => {
      const result = parseModelSpec('ollama:llama3.2@http://gpu-server:11434');
      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('llama3.2');
      expect(result.baseUrl).toBe('http://gpu-server:11434');
    });

    it('should extract https base URL', () => {
      const result = parseModelSpec('custom:mymodel@https://api.example.com');
      expect(result.baseUrl).toBe('https://api.example.com');
      expect(result.model).toBe('mymodel');
    });

    it('should handle base URL with path', () => {
      const result = parseModelSpec('openai:gpt-4o@https://my-proxy.com/v1');
      expect(result.baseUrl).toBe('https://my-proxy.com/v1');
      expect(result.model).toBe('gpt-4o');
    });
  });

  describe('API key extraction', () => {
    it('should extract API key with #', () => {
      const result = parseModelSpec('openai:gpt-4o#sk-test123');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
      expect(result.apiKey).toBe('sk-test123');
    });

    it('should extract both base URL and API key', () => {
      const result = parseModelSpec('custom:mymodel@https://api.example.com#sk-xxx');
      expect(result.provider).toBe('custom');
      expect(result.model).toBe('mymodel');
      expect(result.baseUrl).toBe('https://api.example.com');
      expect(result.apiKey).toBe('sk-xxx');
    });

    it('should handle API key with special chars', () => {
      const result = parseModelSpec('openai:gpt-4o#sk-or-v1-abc123def');
      expect(result.apiKey).toBe('sk-or-v1-abc123def');
    });
  });

  describe('full spec with all parts', () => {
    it('should parse openrouter spec with URL and key', () => {
      const result = parseModelSpec('openrouter:openai/gpt-4o@https://openrouter.ai/api#sk-or-xxx');
      expect(result).toEqual({
        provider: 'openrouter',
        model: 'openai/gpt-4o',
        baseUrl: 'https://openrouter.ai/api',
        apiKey: 'sk-or-xxx',
        raw: 'openrouter:openai/gpt-4o@https://openrouter.ai/api#sk-or-xxx',
      });
    });

    it('should parse ollama on remote server', () => {
      const result = parseModelSpec('ollama:qwen2.5:7b@http://192.168.1.100:11434');
      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('qwen2.5:7b');
      expect(result.baseUrl).toBe('http://192.168.1.100:11434');
    });
  });

  describe('auto-detection (no prefix)', () => {
    it('should auto-detect OpenAI from gpt-* prefix', () => {
      const result = parseModelSpec('gpt-4o');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
    });

    it('should auto-detect OpenAI from gpt-5.2', () => {
      const result = parseModelSpec('gpt-5.2');
      expect(result.provider).toBe('openai');
    });

    it('should auto-detect OpenAI from o1', () => {
      const result = parseModelSpec('o1');
      expect(result.provider).toBe('openai');
    });

    it('should auto-detect OpenAI from o3-mini', () => {
      const result = parseModelSpec('o3-mini');
      expect(result.provider).toBe('openai');
    });

    it('should auto-detect Anthropic from claude-*', () => {
      const result = parseModelSpec('claude-sonnet-4-5-20250929');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('should auto-detect OpenRouter from org/model format', () => {
      const result = parseModelSpec('openai/gpt-4o');
      expect(result.provider).toBe('openrouter');
      expect(result.model).toBe('openai/gpt-4o');
    });

    it('should auto-detect OpenRouter from meta-llama/llama-3.1', () => {
      const result = parseModelSpec('meta-llama/llama-3.1-70b-instruct');
      expect(result.provider).toBe('openrouter');
    });

    it('should auto-detect mock', () => {
      const result = parseModelSpec('mock');
      expect(result.provider).toBe('mock');
    });

    it('should throw for ambiguous model without prefix', () => {
      expect(() => parseModelSpec('llama3.2')).toThrow('Cannot auto-detect provider');
    });

    it('should auto-detect with base URL', () => {
      const result = parseModelSpec('gpt-4o@https://my-proxy.com');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
      expect(result.baseUrl).toBe('https://my-proxy.com');
    });
  });

  describe('whitespace handling', () => {
    it('should trim whitespace', () => {
      const result = parseModelSpec('  openai:gpt-4o  ');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
    });
  });

  describe('error cases', () => {
    it('should throw for empty string', () => {
      expect(() => parseModelSpec('')).toThrow('cannot be empty');
    });

    it('should throw for whitespace only', () => {
      expect(() => parseModelSpec('   ')).toThrow('cannot be empty');
    });

    it('should throw for trailing # with no key', () => {
      expect(() => parseModelSpec('openai:gpt-4o#')).toThrow('trailing \'#\'');
    });

    it('should throw for trailing @ with no URL', () => {
      expect(() => parseModelSpec('openai:gpt-4o@')).toThrow('trailing \'@\'');
    });

    it('should throw for unknown explicit provider', () => {
      expect(() => parseModelSpec('badprovider:model')).toThrow('Cannot auto-detect');
    });

    it('should throw for prefix with no model', () => {
      expect(() => parseModelSpec('openai:')).toThrow('no model name');
    });
  });
});

describe('inferProvider', () => {
  it('should detect Claude models', () => {
    expect(inferProvider('claude-3-opus')).toBe('anthropic');
    expect(inferProvider('claude-sonnet-4-5-20250929')).toBe('anthropic');
    expect(inferProvider('claude-haiku-4-5-20251001')).toBe('anthropic');
  });

  it('should detect GPT models', () => {
    expect(inferProvider('gpt-4o')).toBe('openai');
    expect(inferProvider('gpt-4o-mini')).toBe('openai');
    expect(inferProvider('gpt-5.2')).toBe('openai');
  });

  it('should detect O-series models', () => {
    expect(inferProvider('o1')).toBe('openai');
    expect(inferProvider('o1-mini')).toBe('openai');
    expect(inferProvider('o3')).toBe('openai');
    expect(inferProvider('o3-mini')).toBe('openai');
    expect(inferProvider('o4-mini')).toBe('openai');
  });

  it('should detect OpenRouter format', () => {
    expect(inferProvider('openai/gpt-4o')).toBe('openrouter');
    expect(inferProvider('anthropic/claude-3.5-sonnet')).toBe('openrouter');
    expect(inferProvider('meta-llama/llama-3.1-70b-instruct')).toBe('openrouter');
  });

  it('should detect mock', () => {
    expect(inferProvider('mock')).toBe('mock');
  });

  it('should throw for unknown models', () => {
    expect(() => inferProvider('llama3.2')).toThrow('Cannot auto-detect');
    expect(() => inferProvider('mixtral')).toThrow('Cannot auto-detect');
  });
});

describe('specToModelConfig', () => {
  it('should convert spec to ModelConfig with default ID', () => {
    const spec = parseModelSpec('openai:gpt-4o');
    const config = specToModelConfig(spec);
    expect(config).toEqual({
      id: 'openai:gpt-4o',
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: undefined,
      apiKey: undefined,
    });
  });

  it('should use custom ID when provided', () => {
    const spec = parseModelSpec('openai:gpt-4o');
    const config = specToModelConfig(spec, 'my-gpt');
    expect(config.id).toBe('my-gpt');
  });

  it('should include base URL and API key', () => {
    const spec = parseModelSpec('custom:mymodel@https://api.example.com#sk-xxx');
    const config = specToModelConfig(spec);
    expect(config.baseUrl).toBe('https://api.example.com');
    expect(config.apiKey).toBe('sk-xxx');
  });
});

describe('parseModelConfigFromSpec', () => {
  it('should parse spec string directly to ModelConfig', () => {
    const config = parseModelConfigFromSpec('anthropic:claude-sonnet-4-5-20250929', 'claude-main');
    expect(config.id).toBe('claude-main');
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-sonnet-4-5-20250929');
  });
});

describe('parsePowerAssignments', () => {
  it('should parse per-power assignments', () => {
    const result = parsePowerAssignments({
      ENGLAND: 'openai:gpt-4o',
      FRANCE: 'anthropic:claude-sonnet-4-5-20250929',
    });

    expect(result.models).toHaveLength(2);
    expect(result.powerModelMap.get('ENGLAND')).toBe('openai:gpt-4o');
    expect(result.powerModelMap.get('FRANCE')).toBe('anthropic:claude-sonnet-4-5-20250929');
  });

  it('should deduplicate models with same spec', () => {
    const result = parsePowerAssignments({
      ENGLAND: 'openai:gpt-4o',
      FRANCE: 'openai:gpt-4o',
    });

    expect(result.models).toHaveLength(1);
    expect(result.powerModelMap.get('ENGLAND')).toBe('openai:gpt-4o');
    expect(result.powerModelMap.get('FRANCE')).toBe('openai:gpt-4o');
  });

  it('should include default spec model', () => {
    const result = parsePowerAssignments(
      { ENGLAND: 'openai:gpt-4o' },
      'anthropic:claude-sonnet-4-5-20250929'
    );

    expect(result.models).toHaveLength(2);
  });

  it('should normalize power names to uppercase', () => {
    const result = parsePowerAssignments({ england: 'openai:gpt-4o' });
    expect(result.powerModelMap.get('ENGLAND')).toBe('openai:gpt-4o');
  });
});
