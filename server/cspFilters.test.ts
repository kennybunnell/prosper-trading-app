import { describe, it, expect, beforeAll } from 'vitest';
import { seedCspFilterPresets, getCspFilterPresets, updateCspFilterPreset } from './db';

describe('CSP Filter Presets', () => {
  const testUserId = 1; // Using the actual user ID from the database

  beforeAll(async () => {
    // Seed presets for test user
    await seedCspFilterPresets(testUserId);
  });

  it('should seed default presets for a user', async () => {
    const presets = await getCspFilterPresets(testUserId);
    
    expect(presets).toHaveLength(3);
    expect(presets.map(p => p.presetName).sort()).toEqual(['aggressive', 'conservative', 'medium']);
  });

  it('should have correct conservative preset defaults', async () => {
    const presets = await getCspFilterPresets(testUserId);
    const conservative = presets.find(p => p.presetName === 'conservative');
    
    expect(conservative).toBeDefined();
    expect(conservative?.minDte).toBe(7);
    expect(conservative?.maxDte).toBe(30);
    expect(conservative?.minDelta).toBe('0.10');
    expect(conservative?.maxDelta).toBe('0.20');
    expect(conservative?.minOpenInterest).toBe(50);
    expect(conservative?.minScore).toBe(50);
    expect(conservative?.maxStrikePercent).toBe(150);
  });

  it('should have correct medium preset defaults', async () => {
    const presets = await getCspFilterPresets(testUserId);
    const medium = presets.find(p => p.presetName === 'medium');
    
    expect(medium).toBeDefined();
    expect(medium?.minDte).toBe(7);
    expect(medium?.maxDte).toBe(30);
    expect(medium?.minDelta).toBe('0.15');
    expect(medium?.maxDelta).toBe('0.30');
    expect(medium?.minScore).toBe(40);
    expect(medium?.maxStrikePercent).toBe(250);
  });

  it('should have correct aggressive preset defaults', async () => {
    const presets = await getCspFilterPresets(testUserId);
    const aggressive = presets.find(p => p.presetName === 'aggressive');
    
    expect(aggressive).toBeDefined();
    expect(aggressive?.minDte).toBe(7);
    expect(aggressive?.maxDte).toBe(21);
    expect(aggressive?.minDelta).toBe('0.20');
    expect(aggressive?.maxDelta).toBe('0.40');
    expect(aggressive?.minOpenInterest).toBe(25);
    expect(aggressive?.minScore).toBe(30);
    expect(aggressive?.maxStrikePercent).toBe(500);
  });

  it('should update a preset successfully', async () => {
    await updateCspFilterPreset(testUserId, 'conservative', {
      minScore: 60,
      maxDte: 45,
    });

    const presets = await getCspFilterPresets(testUserId);
    const conservative = presets.find(p => p.presetName === 'conservative');
    
    expect(conservative?.minScore).toBe(60);
    expect(conservative?.maxDte).toBe(45);
    // Other fields should remain unchanged
    expect(conservative?.minDelta).toBe('0.10');
  });

  it('should not create duplicate presets on multiple seed calls', async () => {
    // Call seed again
    await seedCspFilterPresets(testUserId);
    
    const presets = await getCspFilterPresets(testUserId);
    expect(presets).toHaveLength(3);
  });
});
