import * as vscode from 'vscode';
const config = vscode.workspace.getConfiguration('tfdocs');
export const initTool = () => config.get<string>('initTool', 'terraform');
export const enableColorizer = () => config.get<boolean>('enableColorizer', false);
export const useConstraint = () => config.get<string>('useConstraint', 'high');
export const toolName = () => initTool() === 'tofu' ? 'OpenTofu' : 'Terraform';
export const toolCommand = () => initTool() === 'tofu' ? 'tofu' : 'terraform';
export const colorFlag = () => enableColorizer() ? '' : ' -no-color';

export default {
  initTool,
  toolName,
  toolCommand,
  colorFlag,
  enableColorizer,
  useConstraint,
};
