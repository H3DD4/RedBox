import { Router } from 'express';
import { requireAuth as authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db.js';
import {
  getPendingExperiences,
  listPendingValidations,
  saveUserValidatedFindingExperience,
  validateExperience,
  type UserValidatedFindingInput,
} from '../services/experience-memory.js';

const router = Router();
router.use(authMiddleware);

router.get('/pending', (_req, res) => {
  try { res.json({ experiences: listPendingValidations() }); }
  catch { res.status(500).json({ error: 'Failed' }); }
});

router.get('/run/:runId', (req, res) => {
  try { res.json({ experiences: getPendingExperiences(req.params.runId) }); }
  catch { res.status(500).json({ error: 'Failed' }); }
});

router.post('/:id/validate', (req, res) => {
  const { status } = req.body as { status: 'validated'|'partial'|'rejected' };
  const scoreMap: Record<string, number> = { validated: 1.0, partial: 0.5, rejected: -1.0 };
  if (!(status in scoreMap)) { res.status(400).json({ error: 'Invalid status' }); return; }
  try {
    validateExperience(req.params.id, status, scoreMap[status]);
    res.json({ success: true });
  }
  catch { res.status(500).json({ error: 'Failed' }); }
});

router.post('/run/:runId/findings/validate', (req, res) => {
  const { finding, status = 'validated' } = req.body as {
    finding?: UserValidatedFindingInput;
    status?: 'validated' | 'partial' | 'rejected';
  };

  if (!finding || !finding.title || typeof finding.title !== 'string') {
    res.status(400).json({ error: 'Valid finding payload is required' });
    return;
  }

  if (!['validated', 'partial', 'rejected'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  try {
    const db = getDb();
    const run = db
      .prepare('SELECT id, target, test_type, findings FROM runs WHERE id = ?')
      .get(req.params.runId) as {
      id: string;
      target: string;
      test_type: string;
      findings: string;
    } | undefined;

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    let runFindings: UserValidatedFindingInput[] = [];
    try {
      const parsed = JSON.parse(run.findings || '[]');
      if (Array.isArray(parsed)) {
        runFindings = parsed.filter((f): f is UserValidatedFindingInput => !!f && typeof f.title === 'string');
      }
    } catch {
      runFindings = [];
    }

    const matched = runFindings.find((f) => {
      if (f.title !== finding.title) return false;
      if (finding.evidence && f.evidence) {
        return f.evidence === finding.evidence;
      }
      return true;
    });

    if (!matched) {
      res.status(400).json({ error: 'Finding was not found in the selected run' });
      return;
    }

    const saved = saveUserValidatedFindingExperience({
      runId: run.id,
      testType: run.test_type,
      targetSignature: run.target,
      finding: matched,
      status,
    });

    res.json({
      success: true,
      experienceId: saved.experienceId,
      created: saved.created,
      status,
      findingTitle: matched.title,
    });
  } catch {
    res.status(500).json({ error: 'Failed' });
  }
});

export default router;
