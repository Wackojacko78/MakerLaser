import { it, expect } from 'vitest';
import * as t from '../src/lib/transform';
it('loads', () => { expect(Object.keys(t).length).toBeGreaterThan(0); });