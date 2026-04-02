/**
 * BeeMCP Icon Standard - Robust SVG Edition
 * 采用标准内联方式，强制注入渲染尺寸，确保在各种容器下均能显示。
 */

const createIcon = (path, size = 20) => `
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width="${size}" 
    height="${size}" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="var(--nebula-accent)" 
    stroke-width="2.5" 
    stroke-linecap="round" 
    stroke-linejoin="round"
    style="display: block; width: ${size}px; height: ${size}px; flex-shrink: 0; filter: drop-shadow(0 0 2px rgba(234, 179, 8, 0.3));"
  >
    <path d="${path}"/>
  </svg>
`;

export const Icons = {
  // 核心操作
  ADD: createIcon('M12 5v14M5 12h14', 18),
  SEND: createIcon('m22 2-7 20-4-9-9-4Z M22 2 11 13', 18),
  ATTACH: createIcon('m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48', 18),
  
  // 业务域与分类
  BOX: createIcon('M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.27 6.96 12 12.01l8.73-5.05 M12 22.08V12', 18),
  CPU: createIcon('M4 4h16v16H4z M9 9h6v6H9z M15 2v2 M9 2v2 M20 15h2 M20 9h2 M15 20v2 M9 20v2 M2 15h2 M2 9h2', 18),
  LINK: createIcon('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71', 18),
  SETTINGS: createIcon('M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 18),
  ACTIVITY: createIcon('M22 12h-4l-3 9L9 3l-3 9H2', 18),
  
  // 辅助
  FOLDER: createIcon('M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z', 18),
  EARTH: createIcon('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 12),
  TRASH: createIcon('M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 14),
  HELP: createIcon('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 17h.01 M12 13.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 2.5 2.5c0 .7-.3 1.3-.8 1.7-.5.4-.7.8-.7 1.3', 18)
};

