import * as vscode from 'vscode';

export class TerraformInitCodeActionProvider
  implements vscode.CodeActionProvider
{
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
    const actions: vscode.CodeAction[] = [];

    // Check if there are any diagnostics for missing lock file
    const relevantDiagnostics = context.diagnostics.filter(
      diagnostic =>
        diagnostic.source === 'tfdocs' &&
        diagnostic.code === 'tfdocs.missing-lock-file'
    );

    if (relevantDiagnostics.length > 0) {
      const config = vscode.workspace.getConfiguration('tfdocs');
      const initTool = config.get<string>('initTool', 'terraform');
      const toolName = initTool === 'tofu' ? 'OpenTofu' : 'Terraform';
      const toolCommand = initTool === 'tofu' ? 'tofu' : 'terraform';

      const action = new vscode.CodeAction(
        `Run ${toolCommand} init`,
        vscode.CodeActionKind.QuickFix
      );

      action.command = {
        title: `Run ${toolCommand} init`,
        command: 'tfdocs.runTerraformInit',
        arguments: [document],
      };

      action.diagnostics = relevantDiagnostics;
      action.isPreferred = true;

      actions.push(action);
    }

    return actions;
  }
}

export function registerCodeActionProvider(
  context: vscode.ExtensionContext
): void {
  const codeActionProvider = new TerraformInitCodeActionProvider();
  const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
    { language: 'terraform', scheme: 'file' },
    codeActionProvider,
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  );

  context.subscriptions.push(codeActionDisposable);
}
