import * as vscode from "vscode";
import * as path from "path";
import * as fs from 'fs';
import { Python } from "../util/python";
import { Logger } from "../util/logger";
import RstTransformerStatus from './statusBar';
import { Configuration } from '../util/configuration';
import { EsbonioClient } from "../language-server/client";

export class RSTEngine {
  public constructor(
    private readonly python: Python,
    private readonly logger: Logger,
    private readonly status: RstTransformerStatus,
    private readonly esbonio: EsbonioClient
  ) { }

  private errorSnippet(error: string): string {
    return `<html><body>${error}</body></html>`;
  }

  public async compile(fileName: string, uri: vscode.Uri, confPyDirectory: string, fixLinks: boolean, webview: vscode.Webview): Promise<string> {
    this.logger.log(`[preview] Compiling file: ${fileName}`);
    if (confPyDirectory === '' || Configuration.getPreviewName() === 'docutils') {
      if (Configuration.getPreviewName() === 'docutils') {
        this.logger.log('[preview] Forced to use docutils due to setting "preview.name".')
      }

      // docutils
      const writer = Configuration.getDocutilsWriter(uri);
      const writerPart = Configuration.getDocutilsWriterPart(uri);
      return await this.python.exec(
        '"' + path.join(__dirname, '..', '..', 'python-scripts', 'preview.py') + '"',
        '"' + fileName + '"',
        '"' + writer + '"',
        '"' + writerPart + '"'
      );
    } else {
      // sphinx
      let input = confPyDirectory;
      this.logger.log('[preview] Sphinx conf.py directory: ' + input);

      // Make sure the conf.py file exists
      let confFile = path.join(input, 'conf.py');
      if (!fs.existsSync(confFile)) {
        await this.status.reset();
        this.logger.log('[preview] conf.py not found. Refresh the settings.');
        input = confPyDirectory;
        this.logger.log('[preview] Sphinx conf.py directory: ' + input);
        confFile = path.join(input, 'conf.py');
      }

      // The directory where Sphinx will write the html output
      if (this.esbonio.error) {
        return this.showHelp('<p>Esbonio detected build errors.</p>', 'Not Available');
      }
      if (!this.esbonio.ready) {
        return this.showWait();
      }
      const output = this.esbonio.sphinxConfig.buildDir;
      this.logger.log('[preview] Sphinx html directory: ' + output);

      // Calculate full path to built html file.
      let whole = uri.fsPath;
      const ext = whole.lastIndexOf('.');
      whole = whole.substring(0, ext) + '.html';
      const source = path.dirname(whole);
      const sourceRelative = path.relative(confPyDirectory, source);
      const outputRelative = path.relative(confPyDirectory, output);
      const htmlPath = path.join(confPyDirectory, outputRelative, sourceRelative, path.basename(whole));
      return this.previewPage(htmlPath, input, fixLinks, webview);
    }
  }

  private previewPage(htmlPath: string, input: string, fixLinks: boolean, webView: vscode.Webview): Promise<string> {
    this.logger.log('[preview] Working directory: ' + input);
    this.logger.log('[preview] HTML file: ' + htmlPath);

    // Build and display file.
    return new Promise<string>((resolve, reject) => {


      fs.readFile(htmlPath, 'utf8', (err, data) => {
        if (err === null) {
          if (fixLinks) {
            resolve(this.fixLinks(data, htmlPath, webView));
          } else {
            resolve(data);
          }
        } else {
          const description =
            '<p>Cannot read preview page "' + htmlPath + '".</p>\
                      <p>Possible causes are,</p>\
                      <ul>\
                      <li>A wrong "conf.py" file is selected.</li>\
                      <li>Wrong value is set on "esbonio.sphinx.buildDir".</li>\
                      </ul>';
          const errorMessage = [
            err.name,
            err.message,
            err.stack,
          ].join('\n');
          resolve(this.showHelp(description, errorMessage));
        }
      });
    });
  }

  private fixLinks(document: string, documentPath: string, webView: vscode.Webview): string {
    return document.replace(
        new RegExp('((?:src|href)=[\'\"])(.*?)([\'\"])', 'gmi'),
        (subString: string, p1: string, p2: string, p3: string): string => {
          const lower = p2.toLowerCase();
          if (p2.startsWith('#') || lower.startsWith('http://') || lower.startsWith('https://')) {
              return subString;
          }
          const index = p2.indexOf('?');
          if (index > - 1) {
            p2 = p2.substring(0, index);
          }
          const newPath = vscode.Uri.file(path.join(path.dirname(documentPath), p2));
          const newUrl = [
              p1,
              webView.asWebviewUri(newPath),
              p3,
          ].join('');
          return newUrl;
        },
    );
  }

  private showHelp(description: string, error: string): string {
    const help = '<body>\
    <section>\
      <article>\
        <header>\
          <h2>Cannot show preview page.</h2>\
          <h4>Description:</h4>\
          ' + description + '\
          <h4>Detailed error message</h4>\
          <pre>' + error + '</pre>\
          <h4>More Information</h4>\
          <p>Diagnostics information has been written to OUTPUT | Esbonio Language Server panel.</p>\
          <p>The troubleshooting guide can be found at</p>\
          <pre>https://docs.restructuredtext.net/articles/troubleshooting.html</pre>\
        </header>\
      </article>\
    </section>\
  </body>';
    return help;
  }

  private showWait(): string {
    const help = '<body>\
    <section>\
      <article>\
        <header>\
          <h2>Esbonio is busy.</h2>\
          <h4>Description:</h4>\
          <p>Esbonio is still working in the background. This panel will automatically refresh when the preview page is ready.</p>\
          <h4>More Information</h4>\
          <p>Diagnostics information has been written to OUTPUT | Esbonio Language Server panel.</p>\
          <p>The troubleshooting guide can be found at</p>\
          <pre>https://docs.restructuredtext.net/articles/troubleshooting.html</pre>\
        </header>\
      </article>\
    </section>\
  </body>';
    return help;
  }

  public async preview(doc: vscode.TextDocument, webview: vscode.Webview): Promise<string> {
    try {
      if (this.status == null) {
        return this.compile(doc.fileName, doc.uri, '', true, webview);
      } else if (this.status.config == null) {
        await this.status.refreshConfig(doc.uri);
      }
      return this.compile(doc.fileName, doc.uri, this.status.config.confPyDirectory, true, webview);
    } catch (e) {
      return this.errorSnippet(e.toString());
    }
  }
}
