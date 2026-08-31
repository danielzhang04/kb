import { useId, useState } from 'react';

export function AdvancedDisclosure({
  children,
  className = '',
  accessibleLabel = 'Advanced',
  expanded,
  onExpandedChange,
}: {
  children: React.ReactNode;
  className?: string;
  accessibleLabel?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}): React.JSX.Element {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const disclosureId = useId();
  const isExpanded = expanded ?? internalExpanded;
  const toggle = (): void => {
    const next = !isExpanded;
    if (expanded === undefined) setInternalExpanded(next);
    onExpandedChange?.(next);
  };

  return <div className={`workflow-advanced${className ? ` ${className}` : ''}`}>
    <button
      type="button"
      className="workflow-advanced__toggle"
      aria-label={accessibleLabel}
      aria-expanded={isExpanded}
      aria-controls={disclosureId}
      onClick={toggle}
    >
      <span>Advanced</span>
      <span aria-hidden="true">{isExpanded ? '▴' : '▾'}</span>
    </button>
    <div id={disclosureId} className="workflow-advanced__body" hidden={!isExpanded}>
      {isExpanded ? children : null}
    </div>
  </div>;
}
