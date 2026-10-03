// Material Symbols paths (viewBox 0 -960 960 960). add, close and stop are not used by the UI.
export const ICONS = {
  down: "M446.67-800v513l-240-240L160-480l320 320 320-320-46.67-47-240 240v-513h-66.66Z",
  menu: "M120-240v-66.67h720V-240H120Zm0-206.67v-66.66h720v66.66H120Zm0-206.66V-720h720v66.67H120Z",
  add: "M446.67-446.67H200v-66.66h246.67V-760h66.66v246.67H760v66.66H513.33V-200h-66.66v-246.67Z",
  close: "m251.33-204.67-46.66-46.66L433.33-480 204.67-708.67l46.66-46.66L480-526.67l228.67-228.66 46.66 46.66L526.67-480l228.66 228.67-46.66 46.66L480-433.33 251.33-204.67Z",
  stop: "M306.67-653.33v346.66-346.66ZM240-240v-480h480v480H240Zm66.67-66.67h346.66v-346.66H306.67v346.66Z",
  play: "M320-202v-560l440 280-440 280Zm66.67-280Zm0 158.67L636-482 386.67-640.67v317.34Z",
  pause: "M520-200v-560h160v560H520Zm-240 0v-560h160v560H280Z",
  more: "M480-160q-33 0-56.5-23.5T400-240q0-33 23.5-56.5T480-320q33 0 56.5 23.5T560-240q0 33-23.5 56.5T480-160Zm0-240q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm0-240q-33 0-56.5-23.5T400-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T560-720q0 33-23.5 56.5T480-640Z",
};

export function Icon({ d }) {
  return (
    <svg viewBox="0 -960 960 960" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// Shows the theme the button switches to: a sun while dark, a moon while light.
export function ThemeIcon({ dark }) {
  return dark ? (
    <svg className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ) : (
    <svg className="theme-icon moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
