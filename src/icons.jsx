const Icon = ({ children, size = 20, strokeWidth = 1.8, ...props }) => (
  <svg
    aria-hidden="true"
    fill="none"
    height={size}
    viewBox="0 0 24 24"
    width={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={strokeWidth}
    {...props}
  >
    {children}
  </svg>
);

export const PlusIcon = (props) => (
  <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>
);

export const StudiesIcon = (props) => (
  <Icon {...props}><path d="M3.5 7.5h17v12h-17z" /><path d="M7 7.5V5h6l2 2.5" /></Icon>
);

export const TemplateIcon = (props) => (
  <Icon {...props}><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4M9 12h6M9 16h6" /></Icon>
);

export const HelpIcon = (props) => (
  <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.1 2.3c-.8.3-1.2.8-1.2 1.7M12 17h.01" /></Icon>
);

export const ChevronDownIcon = (props) => (
  <Icon {...props}><path d="m8 10 4 4 4-4" /></Icon>
);

export const PeopleIcon = (props) => (
  <Icon {...props}><path d="M16 20v-1.8c0-2.3-1.8-4.2-4.2-4.2H7.2A4.2 4.2 0 0 0 3 18.2V20" /><circle cx="9.5" cy="7" r="3" /><path d="M16 4.4a3 3 0 0 1 0 5.8M18 14.3a4.2 4.2 0 0 1 3 4V20" /></Icon>
);

export const PlayIcon = (props) => (
  <Icon {...props} fill="currentColor" stroke="none"><path d="m8 5 10 7-10 7z" /></Icon>
);

export const ExportIcon = (props) => (
  <Icon {...props}><path d="M12 15V3M8 7l4-4 4 4" /><path d="M5 12v8h14v-8" /></Icon>
);

export const InfoIcon = (props) => (
  <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Icon>
);

export const MenuIcon = (props) => (
  <Icon {...props}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>
);

export const CloseIcon = (props) => (
  <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>
);

export const CheckIcon = (props) => (
  <Icon {...props}><path d="m6.5 12.5 3.2 3.2 7.8-8" /></Icon>
);

export const LinkIcon = (props) => (
  <Icon {...props}><path d="M10 13.8a4 4 0 0 0 5.7 0l2.1-2.1a4 4 0 0 0-5.6-5.7l-1.2 1.2" /><path d="M14 10.2a4 4 0 0 0-5.7 0l-2.1 2.1a4 4 0 0 0 5.6 5.7l1.2-1.2" /></Icon>
);

export const TrashIcon = (props) => (
  <Icon {...props}><path d="M4.5 7h15M9 7V4.5h6V7M7 7l.7 13h8.6L17 7M10 11v5M14 11v5" /></Icon>
);

export const CopyIcon = (props) => (
  <Icon {...props}><rect x="8" y="8" width="11" height="11" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></Icon>
);

export const ReplayIcon = (props) => (
  <Icon {...props}><path d="M4.5 9A8 8 0 1 1 5 16.2" /><path d="M4.5 4.5V9H9" /></Icon>
);

export const FileIcon = (props) => (
  <Icon {...props}><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4M9 12h6M9 16h4" /></Icon>
);

export const BookmarkIcon = (props) => (
  <Icon {...props}><path d="M6.5 4.5h11v16L12 17l-5.5 3.5z" /></Icon>
);

export const GlobeIcon = (props) => (
  <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Icon>
);
