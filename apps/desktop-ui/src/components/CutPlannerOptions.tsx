import { PLANNER_OPTIONS, plannerOnCount, plannerValue, type PlannerKey } from '@/lib/cutPlanner';
import type { ProjectSettings } from '@/types/domain';

/**
 * The "Path planning" tick boxes at the top of the Layers panel: how the head moves inside a layer (the order
 * of the layers themselves is the run order just above). Changing one makes the preview stale, like any edit,
 * so Generate & Preview has to be pressed again.
 */
export function CutPlannerOptions({
  settings,
  onChange,
}: {
  settings: Pick<ProjectSettings, PlannerKey>;
  onChange: (key: PlannerKey, value: boolean) => void;
}) {
  return (
    <div className="planner" style={{ margin: '4px 0 8px' }}>
      <p className="hint" style={{ margin: '4px 0 2px', fontWeight: 600 }}>
        Path planning ({plannerOnCount(settings)} of {PLANNER_OPTIONS.length} on)
      </p>
      {PLANNER_OPTIONS.map((o) => (
        <label key={o.key} className="check" title={o.help} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', margin: '2px 0' }}>
          <input type="checkbox" checked={plannerValue(settings, o.key)} onChange={(e) => onChange(o.key, e.target.checked)} />
          <span>{o.label}</span>
        </label>
      ))}
      <p className="hint" style={{ margin: '2px 0 0' }}>
        These change how the head moves inside a layer. Generate again to see it: the Travel tick box shows the moves with the laser off.
      </p>
    </div>
  );
}
