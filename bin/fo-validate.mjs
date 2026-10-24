#!/usr/bin/env node
import { register } from 'tsx/esm/api';

register();
await import('../scripts/validate_data.ts');
