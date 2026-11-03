import { Navigate, useParams } from 'react-router-dom';

/** Profiles became projects; old bookmarks keep working. */
export function LegacyProfileRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/projects/${id}`} replace />;
}
