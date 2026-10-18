/** Scoped administration styles share the generated application's design tokens. */
export const iamStyles = `
.ng-iam-activity ul{list-style:none;margin:0;padding:0 24px 24px}.ng-iam-activity li{padding:16px 0;border-top:1px solid #e4e7ec;display:grid;gap:6px;overflow-wrap:anywhere}.ng-iam-activity li>span,.ng-iam-activity time{font-size:13px;color:#667085}.ng-iam-activity pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f8fafc;padding:16px;border-radius:10px}.ng-iam-activity summary{cursor:pointer;font-size:13px;color:#175cd3}

.ng-iam-page { max-width: 1280px; margin: 0 auto; padding: 40px 36px 48px; color: var(--ng-foreground); }
.ng-iam-breadcrumb { display: flex; align-items: center; gap: 12px; min-height: 32px; margin-bottom: 35px; font-size: 13px; color: var(--ng-muted); }
.ng-iam-breadcrumb a { font-weight: 550; color: var(--ng-foreground); }
.ng-iam-breadcrumb a:hover { color: var(--ng-primary); }
.ng-iam-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
.ng-iam-eyebrow { margin: 0 0 10px; color: var(--ng-primary); font-size: 11px; letter-spacing: .13em; font-weight: 750; }
.ng-iam-heading h1 { margin: 0; font-size: clamp(27px, 3vw, 36px); line-height: 1.2; letter-spacing: -.045em; font-weight: 730; }
.ng-iam-heading > div > p:last-child { max-width: 640px; margin: 12px 0 0; font-size: 14px; line-height: 1.7; color: var(--ng-muted); }
.ng-iam-live { display: flex; align-items: center; gap: 7px; flex-shrink: 0; padding-bottom: 4px; color: var(--ng-muted); font-size: 12px; }
.ng-iam-live > span { height: 6px; width: 6px; border-radius: 50%; background: #12b76a; box-shadow: 0 0 0 3px #e8f9ef; }
.ng-iam-workspace { display: grid; gap: 20px; }
.ng-iam-summary { display: grid; grid-template-columns: repeat(auto-fit,minmax(200px,1fr)); gap: 16px; }
.ng-iam-stat { display: grid; grid-template-columns: 42px 1fr; gap: 4px 14px; align-items: start; border: 1px solid var(--ng-border); background: var(--ng-surface); border-radius: 14px; padding: 20px; }
.ng-iam-stat-icon { grid-row: 1 / 3; width: 40px; height: 40px; display: grid; place-items: center; border: 1px solid #dbe6fb; border-radius: 11px; color: var(--ng-primary); background: #f2f6ff; }
.ng-iam-stat > div { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.ng-iam-stat > div > span { color: #475467; font-size: 13px; font-weight: 600; }
.ng-iam-stat strong { font-size: 27px; font-weight: 700; line-height: 1; letter-spacing: -.04em; }
.ng-iam-stat p { margin: 3px 0 0; font-size: 12px; line-height: 1.5; color: var(--ng-muted); }
.ng-iam-card { background: var(--ng-surface); border: 1px solid var(--ng-border); border-radius: 16px; box-shadow: 0 4px 16px #10182804; overflow: hidden; min-width: 0; }
.ng-iam-card-top { display: flex; justify-content: space-between; align-items: center; padding: 0 24px; border-bottom: 1px solid var(--ng-border); gap: 16px; }
.ng-iam-tabs { display: flex; gap: 26px; }
.ng-iam-tabs button { display: inline-flex; align-items: center; gap: 8px; padding: 19px 0 17px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--ng-muted); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
.ng-iam-tabs button[aria-selected="true"] { color: var(--ng-primary); border-bottom-color: var(--ng-primary); }
.ng-iam-tabs button > span { min-width: 23px; padding: 1px 6px; border-radius: 6px; font-size: 11px; background: #f2f4f7; color: #667085; }
.ng-iam-tabs button[aria-selected="true"] > span { background: #eff4ff; color: var(--ng-primary); }
.ng-iam-card-hint, .ng-iam-footnote { display: inline-flex; align-items: center; gap: 6px; color: var(--ng-muted); font-size: 11px; }
.ng-iam-card-hint svg, .ng-iam-footnote svg { width: 13px; height: 13px; }
.ng-iam-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 24px; }
.ng-iam-toolbar h2 { font-size: 17px; font-weight: 680; letter-spacing: -.02em; margin: 0; }
.ng-iam-toolbar p { margin: 5px 0 0; color: var(--ng-muted); font-size: 12px; line-height: 1.6; }
.ng-iam-toolbar-actions { display: flex; align-items: center; gap: 10px; }
.ng-iam-toolbar-actions .ng-button { white-space: nowrap; font-size: 12px; min-height: 38px; padding: 0 13px; border-radius: 8px; }
.ng-iam-search { display: flex; align-items: center; gap: 8px; min-height: 38px; border: 1px solid var(--ng-border); border-radius: 8px; padding: 0 11px; color: #98a2b3; }
.ng-iam-search input { border: 0; background: transparent; width: 160px; min-width: 0; padding: 8px 0; outline: none; color: var(--ng-foreground); font: inherit; font-size: 12px; }
.ng-iam-search:focus-within { border-color: #84adff; box-shadow: 0 0 0 3px #eff4ff; }
.ng-iam-card .ng-table-wrap { border: 0; border-radius: 0; }
.ng-iam-card table { width: 100%; }
.ng-iam-card th { background: #f9fafb; padding: 11px 24px; border-top: 1px solid var(--ng-border); color: #667085; text-transform: none; letter-spacing: 0; font-size: 11px; font-weight: 600; white-space: nowrap; }
.ng-iam-card td { padding: 18px 24px; vertical-align: middle; }
.ng-iam-card tbody tr:last-child td { border-bottom: 0; }
.ng-iam-card tbody tr:hover { background: #fcfdff; }
.ng-iam-role-cell, .ng-iam-person { display: flex; align-items: center; gap: 12px; min-width: 180px; }
.ng-iam-role-icon { flex-shrink: 0; display: grid; place-items: center; width: 36px; height: 36px; background: #f8fafc; border: 1px solid var(--ng-border); border-radius: 9px; color: #667085; }
.ng-iam-role-icon--system { background: #eff4ff; border-color: #dbe6fb; color: var(--ng-primary); }
.ng-iam-role-name { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; font-size: 13px; color: var(--ng-foreground); font-weight: 650; }
.ng-iam-role-id { display: block; margin-top: 3px; font-size: 11px; color: var(--ng-muted); font-family: ui-monospace, monospace; }
.ng-iam-role-cell p { margin: 5px 0 0; max-width: 280px; color: var(--ng-muted); font-size: 12px; overflow-wrap: anywhere; }
.ng-iam-grants { display: flex; flex-wrap: wrap; gap: 6px; max-width: 430px; }
.ng-iam-tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border: 1px solid #e7eaf0; border-radius: 6px; background: #f9fafb; color: #475467; font-size: 10px; font-weight: 550; line-height: 1.6; }
.ng-iam-tag svg { width: 11px; height: 11px; }
.ng-iam-tag--system, .ng-iam-tag--full { background: #eff4ff; color: #3538cd; border-color: #e0e7ff; }
.ng-iam-tag--admin { background: #f7f5ff; border-color: #ece8fe; color: #6941c6; }
.ng-iam-muted { color: #98a2b3; font-size: 12px; }
.ng-iam-actions-label { display: block; text-align: right; }
.ng-iam-row-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.ng-iam-edit, .ng-iam-icon-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 5px 8px; background: transparent; border: 1px solid transparent; border-radius: 7px; color: #475467; font: inherit; font-size: 12px; font-weight: 550; cursor: pointer; }
.ng-iam-edit svg, .ng-iam-icon-button svg { width: 15px; height: 15px; }
.ng-iam-edit:hover:enabled { background: #f2f4f7; border-color: #eaecf0; }
.ng-iam-icon-button--danger:hover:enabled { background: #fef3f2; color: #b42318; }
.ng-iam-edit:disabled, .ng-iam-icon-button:disabled { opacity: .35; cursor: not-allowed; }
.ng-iam-card-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; border-top: 1px solid var(--ng-border); padding: 14px 24px; color: var(--ng-muted); font-size: 11px; }
.ng-iam-card-footer > span { display: flex; align-items: center; gap: 6px; }
.ng-iam-card-footer > span svg { width: 13px; height: 13px; }
.ng-iam-avatar { flex-shrink: 0; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; font-size: 11px; font-weight: 650; background: #eef2f9; color: #475467; border: 1px solid #e4e7ec; }
.ng-iam-email { display: block; font-size: 12px; margin-top: 4px; color: var(--ng-muted); overflow-wrap: anywhere; }
.ng-iam-role-picker { width: 240px; max-width: 100%; margin-left: auto; }
.ng-iam-role-picker .ng-input { font-size: 12px; min-height: 36px; padding: 7px 10px; }
.ng-iam-pagination { display: flex; align-items: center; gap: 14px; }
.ng-iam-pagination .ng-button { min-height: 30px; padding: 0 10px; font-size: 11px; border-radius: 7px; }
.ng-iam-empty { padding: 52px 24px; color: var(--ng-muted); text-align: center; display: grid; justify-items: center; gap: 9px; font-size: 13px; }
.ng-iam-empty > svg { height: 26px; width: 26px; color: #98a2b3; }
.ng-iam-empty h3 { margin: 3px 0 0; color: #344054; font-weight: 600; }
.ng-iam-empty p { margin: 0; }
.ng-iam-message { display: flex; align-items: center; gap: 10px; padding: 13px 16px; border: 1px solid; border-radius: 10px; font-size: 13px; line-height: 1.6; }
.ng-iam-message--error { background: #fef3f2; border-color: #fee4e2; color: #b42318; }
.ng-iam-message--success { background: #f0fdf4; border-color: #dcfae6; color: #067647; }
.ng-iam-message button { margin-left: auto; border: 0; background: transparent; font: inherit; text-decoration: underline; cursor: pointer; }
.ng-iam-footnote { justify-content: center; margin: 0; font-size: 11px; }
.ng-iam-editor { display: grid; gap: 24px; }
.ng-dialog:has(.ng-iam-editor) { width: min(660px, calc(100% - 32px)); max-height: calc(100dvh - 40px); overflow: hidden; margin: auto; }
.ng-dialog:has(.ng-iam-editor) .ng-dialog-content { max-height: calc(100dvh - 158px); overflow-y: auto; }
.ng-iam-editor h3 { margin: 0 0 14px; font-size: 13px; font-weight: 650; color: #344054; }
.ng-iam-field-grid { display: grid; grid-template-columns: 1fr 1fr; align-items: start; gap: 16px; margin-bottom: 16px; }
.ng-iam-editor label { font-size: 12px; font-weight: 550; }
.ng-iam-editor .ng-input { font-size: 13px; min-height: 38px; }
.ng-iam-editor small, .ng-iam-optional { color: var(--ng-muted); font-size: 11px; font-weight: 400; }
.ng-iam-optional { margin-left: 5px; }
.ng-iam-code { font-family: ui-monospace, monospace; }
.ng-iam-permissions-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.ng-iam-permissions-heading h3 { margin-bottom: 5px; }
.ng-iam-permissions-heading p { font-size: 12px; color: var(--ng-muted); margin: 0; }
.ng-iam-permissions-heading > .ng-iam-tag { white-space: nowrap; }
.ng-iam-editor-note { display: flex; align-items: flex-start; gap: 10px; padding: 12px; margin-bottom: 14px; border: 1px solid #dbe6fb; border-radius: 10px; color: #3538cd; background: #f5f8ff; font-size: 12px; line-height: 1.5; }
.ng-iam-editor-note > svg { flex-shrink: 0; margin-top: 1px; }
.ng-iam-editor-note p { margin: 3px 0 0; font-size: 11px; color: #61708a; }
.ng-iam-permission-groups { display: grid; gap: 14px; }
.ng-iam-permission-group { margin: 0; padding: 4px 12px 12px; border: 1px solid var(--ng-border); border-radius: 10px; min-width: 0; }
.ng-iam-permission-group legend { display: flex; align-items: center; gap: 6px; padding: 0 6px; margin-left: -2px; font-size: 11px; font-weight: 650; color: #475467; }
.ng-iam-permission-group legend svg { width: 13px; height: 13px; }
.ng-iam-permission { display: grid; grid-template-columns: 16px 1fr; gap: 10px; align-items: start; padding: 10px; margin-top: 6px; border: 1px solid transparent; border-radius: 7px; cursor: pointer; }
.ng-iam-permission:hover { background: #f9fafb; }
.ng-iam-permission--selected { background: #f5f8ff; border-color: #e0eaff; }
.ng-iam-permission input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--ng-primary); cursor: pointer; }
.ng-iam-permission input:disabled { cursor: not-allowed; }
.ng-iam-permission > span { display: grid; gap: 3px; }
.ng-iam-permission strong { font-size: 12px; color: #344054; font-weight: 600; }
.ng-iam-permission > span > span { color: var(--ng-muted); font-size: 11px; font-weight: 400; line-height: 1.5; }
.ng-iam-permission code { font-size: 10px; color: #98a2b3; font-weight: 400; overflow-wrap: anywhere; }
.ng-iam-editor-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--ng-border); padding: 16px 24px; position: sticky; bottom: -24px; margin: 0 -24px -24px; background: var(--ng-surface); z-index: 1; }
.ng-iam-editor-footer .ng-button { min-height: 36px; padding: 0 15px; font-size: 12px; border-radius: 8px; }
.ng-iam-delete-confirm { color: #fff; background: #d92d20; }
.ng-iam-delete-confirm:hover:enabled { background: #b42318; }
.ng-iam-page button:focus-visible, .ng-iam-editor input:focus-visible, .ng-iam-editor button:focus-visible { outline: 3px solid #84adff; outline-offset: 3px; }
@media (max-width: 1000px) { .ng-iam-heading { align-items: flex-start; flex-direction: column; gap: 14px; } .ng-iam-toolbar { align-items: flex-start; flex-direction: column; } .ng-iam-toolbar-actions { width: 100%; } .ng-iam-search { flex: 1; } .ng-iam-search input { width: 100%; } }
@media (max-width: 640px) { .ng-iam-page { padding: 88px 16px 32px; } .ng-iam-breadcrumb { margin-bottom: 22px; } .ng-iam-summary { grid-template-columns: 1fr; gap: 9px; } .ng-iam-stat { padding: 14px 16px; } .ng-iam-card-top { padding: 0 16px; } .ng-iam-card-hint { display: none; } .ng-iam-toolbar { padding: 20px 16px; } .ng-iam-toolbar-actions { flex-wrap: wrap; } .ng-iam-search { min-width: 130px; } .ng-iam-card th, .ng-iam-card td { padding-left: 16px; padding-right: 16px; } .ng-iam-card-footer { padding: 14px 16px; } .ng-iam-role-cell { min-width: 150px; } .ng-iam-grants { min-width: 160px; } .ng-iam-role-picker { width: 165px; } .ng-iam-field-grid { grid-template-columns: 1fr; gap: 14px; } .ng-iam-permissions-heading { align-items: flex-start; flex-direction: column; } }
@media (max-width: 640px) {
 .ng-iam-card .ng-iam-roles-table, .ng-iam-card .ng-iam-users-table { display: block; }
 .ng-iam-card .ng-iam-roles-table thead, .ng-iam-card .ng-iam-users-table thead { display: none; }
 .ng-iam-card .ng-iam-roles-table tbody, .ng-iam-card .ng-iam-users-table tbody { display: block; }
 .ng-iam-card .ng-iam-roles-table tr, .ng-iam-card .ng-iam-users-table tr { display: grid; gap: 14px; padding: 18px 16px; position: relative; border-top: 1px solid var(--ng-border); }
 .ng-iam-card .ng-iam-roles-table td, .ng-iam-card .ng-iam-users-table td { display: block; padding: 0; border: 0; }
 .ng-iam-card .ng-iam-roles-table td:first-child { padding-right: 78px; }
 .ng-iam-card .ng-iam-roles-table td:last-child { position: absolute; right: 12px; top: 18px; }
 .ng-iam-card .ng-iam-users-table td:last-child::before { content: "Assigned role"; display: block; color: var(--ng-muted); font-size: 11px; margin-bottom: 6px; }
 .ng-iam-role-cell, .ng-iam-person { min-width: 0; }
 .ng-iam-role-cell > div, .ng-iam-person > div { min-width: 0; }
 .ng-iam-role-name, .ng-iam-role-id { overflow-wrap: anywhere; }
 .ng-iam-grants { min-width: 0; margin-left: 48px; }
 .ng-iam-role-picker { width: 100%; }
}
`;
