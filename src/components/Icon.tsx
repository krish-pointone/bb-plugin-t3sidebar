import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowTurnBackwardIcon,
  ArrowUp01Icon,
  Add01Icon,
  CancelCircleIcon,
  CheckListIcon,
  Clock01Icon,
  CommandIcon,
  ComputerTerminal01Icon,
  Edit02Icon,
  Folder01Icon,
  HelpCircleIcon,
  Loading03Icon,
  Target02Icon,
  Tick02Icon,
  Delete02Icon,
  UserAdd01Icon,
  WorkflowCircle03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";

const ICON_MAP = {
  Add: Add01Icon,
  ArrowTurnBackward: ArrowTurnBackwardIcon,
  Check: Tick02Icon,
  ChevronDown: ArrowDown01Icon,
  ChevronLeft: ArrowLeft01Icon,
  ChevronUp: ArrowUp01Icon,
  CircleQuestion: HelpCircleIcon,
  CircleX: CancelCircleIcon,
  Clock: Clock01Icon,
  Command: CommandIcon,
  Edit: Edit02Icon,
  Folder: Folder01Icon,
  ListTodo: CheckListIcon,
  Loading: Loading03Icon,
  Target: Target02Icon,
  Terminal: ComputerTerminal01Icon,
  Trash: Delete02Icon,
  UserRoundPlus: UserAdd01Icon,
  Workflow: WorkflowCircle03Icon,
} as const satisfies Record<string, IconSvgElement>;

export type IconName = keyof typeof ICON_MAP;

export function Icon({
  name,
  className,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: {
  name: IconName;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}) {
  return (
    <HugeiconsIcon
      icon={ICON_MAP[name]}
      className={cn(className)}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
    />
  );
}
