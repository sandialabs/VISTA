import React from 'react';
import { PROJECT_PHASE_LABELS, PROJECT_PHASE_SEQUENCE } from '../utils/projectPhases';

function ProjectPhaseFlow({ currentPhase }) {
  return (
    <div className="phase-flow" aria-label="Project phase flow">
      {PROJECT_PHASE_SEQUENCE.map((phase, index) => (
        <React.Fragment key={phase}>
          {index > 0 && <span className="phase-flow-arrow">→</span>}
          <span className={`phase-flow-node ${currentPhase === phase ? 'active' : ''}`}>
            {PROJECT_PHASE_LABELS[phase]}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

export default ProjectPhaseFlow;
