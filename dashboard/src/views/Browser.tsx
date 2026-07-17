/**
 * Files — the read-only KB explorer. A thin wrapper over the shared FolderView (src/views/folderView.tsx)
 * rooted at the whole knowledge base. Two-pane VS-Code-style layout: directory tree left, rendered
 * file content right (markdown rendered-first at reading width). All data comes from the GET-only
 * /api/kb/* routes; there is no write path here. Inline editing arrives post-merge — this view is
 * strictly read-only.
 */
import { FolderView } from './folderView';
import '../styles/views/files.css';

export function Browser(): React.JSX.Element {
  return (
    <div className="v-files">
      <FolderView root="" emptyHint="Select a file from the tree to read it." />
    </div>
  );
}
