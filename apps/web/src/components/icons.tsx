import type { SVGProps } from 'react';

/**
 * One small icon family: 24px grid, 1.8 stroke, round caps and joins. Drawn here rather than pulled
 * from a library so the app has no extra dependency, and so every icon shares the same weight.
 * Decorative by default (aria-hidden): put the meaning in the button's label, not in the icon.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconBack = (p: IconProps) => (
  <Icon {...p}><path d="M15 5l-7 7 7 7" /></Icon>
);
export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}><path d="M9 5l7 7-7 7" /></Icon>
);
export const IconCompass = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" /></Icon>
);
export const IconBag = (p: IconProps) => (
  <Icon {...p}><path d="M5 8h14l-1 11a2 2 0 0 1-2 1.8H8A2 2 0 0 1 6 19L5 8z" /><path d="M9 8V6.5A3 3 0 0 1 12 4a3 3 0 0 1 3 2.5V8" /></Icon>
);
export const IconPlus = (p: IconProps) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);
export const IconUser = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="8.5" r="3.6" /><path d="M5 20a7 7 0 0 1 14 0" /></Icon>
);
export const IconSend = (p: IconProps) => (
  <Icon {...p}><path d="M5 12l14-7-5 14-3-6-6-1z" /><path d="M11 13l8-8" /></Icon>
);
export const IconCalendar = (p: IconProps) => (
  <Icon {...p}><rect x="4" y="5.5" width="16" height="14.5" rx="3" /><path d="M8 3.5v4M16 3.5v4M4 10h16" /></Icon>
);
export const IconPin = (p: IconProps) => (
  <Icon {...p}><path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.3" /></Icon>
);
export const IconUsers = (p: IconProps) => (
  <Icon {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5a6 6 0 0 1 12 0" /><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M18 14.2a6 6 0 0 1 3 5.3" /></Icon>
);
export const IconWallet = (p: IconProps) => (
  <Icon {...p}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="8" width="16" height="11.5" rx="2.5" /><circle cx="16" cy="13.8" r="1" fill="currentColor" stroke="none" /></Icon>
);
export const IconChat = (p: IconProps) => (
  <Icon {...p}><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /></Icon>
);
export const IconStar = (p: IconProps) => (
  <Icon {...p}><path d="M12 4l2.4 5 5.4.7-4 3.7 1 5.4L12 16.2 7.2 18.8l1-5.4-4-3.7 5.4-.7L12 4z" /></Icon>
);
export const IconShield = (p: IconProps) => (
  <Icon {...p}><path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6.1l7-2.6z" /><path d="M9 12l2.2 2.2L15.5 10" /></Icon>
);
export const IconSearch = (p: IconProps) => (
  <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></Icon>
);
export const IconBell = (p: IconProps) => (
  <Icon {...p}><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></Icon>
);
export const IconLogout = (p: IconProps) => (
  <Icon {...p}><path d="M10 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h3" /><path d="M15 8l4 4-4 4M19 12H9.5" /></Icon>
);
export const IconClose = (p: IconProps) => (
  <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>
);
export const IconCheck = (p: IconProps) => (
  <Icon {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>
);
export const IconSliders = (p: IconProps) => (
  <Icon {...p}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Icon>
);
export const IconEdit = (p: IconProps) => (
  <Icon {...p}><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z" /></Icon>
);
export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.8l1.7 2.2 2.8-.6 1.1 2.7 2.7 1.1-.6 2.8 2.2 1.7-2.2 1.7.6 2.8-2.7 1.1-1.1 2.7-2.8-.6L12 21.2l-1.7-2.2-2.8.6-1.1-2.7-2.7-1.1.6-2.8L2.1 12l2.2-1.7-.6-2.8 2.7-1.1 1.1-2.7 2.8.6L12 2.8z" />
    <circle cx="12" cy="12" r="3.1" />
  </Icon>
);
export const IconArrowDown = (p: IconProps) => (
  <Icon {...p}><path d="M12 5v14M6 13l6 6 6-6" /></Icon>
);

export const IconMic = (p: IconProps) => (
  <Icon {...p}><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" /></Icon>
);
export const IconImage = (p: IconProps) => (
  <Icon {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.8" /><path d="M4 17l4.5-4.5L12 16l3-3 5 5" /></Icon>
);
export const IconSmile = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 14a4 4 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" strokeWidth={2.6} /></Icon>
);
export const IconTrash = (p: IconProps) => (
  <Icon {...p}><path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 12a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8l1-12" /><path d="M10 11v6M14 11v6" /></Icon>
);
export const IconStop = (p: IconProps) => (
  <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" /></Icon>
);
export const IconPlay = (p: IconProps) => (
  <Icon {...p}><path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" /></Icon>
);
export const IconPause = (p: IconProps) => (
  <Icon {...p}><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></Icon>
);
export const IconCamera = (p: IconProps) => (
  <Icon {...p}><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.3-2h6l1.3 2h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8z" /><circle cx="12" cy="12.5" r="3.4" /></Icon>
);
export const IconSun = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></Icon>
);
export const IconMoon = (p: IconProps) => (
  <Icon {...p}><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" /></Icon>
);
export const IconEye = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></Icon>
);
export const IconLock = (p: IconProps) => (
  <Icon {...p}><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></Icon>
);
export const IconHistory = (p: IconProps) => (
  <Icon {...p}><path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5M4 4v4.5h4.5" /><path d="M12 8v4.5l3 1.8" /></Icon>
);
export const IconBan = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></Icon>
);
export const IconInfo = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6h.01" strokeWidth={2.4} /></Icon>
);
export const IconDownload = (p: IconProps) => (
  <Icon {...p}><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></Icon>
);
export const IconDoubleCheck = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 12.5l4.5 4.5 7-9M10.5 15.5l1.5 1.5 8-9.5" /></Icon>
);

/** The mark: two stops joined by a dashed route. Works at any size; takes its colour from the text. */
export function LogoMark({ size = 28, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" {...rest}>
      <path d="M9 22.5C9 14 23 18 23 9.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="1.2 4.6" />
      <circle cx="8" cy="23.5" r="4.4" fill="currentColor" />
      <circle cx="24" cy="8.5" r="4.4" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}
