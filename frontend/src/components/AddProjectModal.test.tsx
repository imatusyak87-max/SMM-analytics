import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddProjectModal } from './AddProjectModal';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const post = apiClient.post as any;

function ProjectStub() {
  const { state } = useLocation();
  return <p>project {JSON.stringify(state)}</p>;
}

function renderModal() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <Routes>
        <Route path="/projects" element={<AddProjectModal onClose={() => {}} />} />
        <Route path="/projects/:id" element={<ProjectStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  post.mockImplementation((url: string) =>
    url === '/accounts/preview' ? new Promise(() => {}) : Promise.resolve({ data: { profile: { id: 'p9' }, added: [], failed: [{ platform: 'telegram', message: 'Канал не найден' }] } }));
});

describe('AddProjectModal', () => {
  it('asks for a name with examples and a link per network', () => {
    renderModal();
    expect(screen.getByPlaceholderText('Например: Pheromone, Мезопроф, Ренессанс Страхование')).toBeInTheDocument();
    for (const name of ['Instagram', 'Telegram', 'ВКонтакте', 'YouTube']) expect(screen.getByLabelText(name)).toBeInTheDocument();
    expect(screen.getByText('Например: https://vk.com/brand')).toBeInTheDocument();
    expect(screen.getByText('Например: https://youtube.com/@brand')).toBeInTheDocument();
  });

  it('keeps VK and YouTube disabled for now', () => {
    renderModal();
    expect(screen.getByLabelText('ВКонтакте')).toBeDisabled();
    expect(screen.getByLabelText('YouTube')).toBeDisabled();
    expect(screen.getAllByText('Скоро')).toHaveLength(2);
  });

  it('needs a name before it can create', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Создать проект' })).toBeDisabled();
  });

  it('creates the project with the filled links and opens it with what failed', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Pheromone' } });
    fireEvent.change(screen.getByLabelText('Telegram'), { target: { value: 'https://t.me/ph_channel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать проект' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/profiles', { name: 'Pheromone', links: { telegram: 'https://t.me/ph_channel' } }));
    expect(await screen.findByText(/project/)).toHaveTextContent('Канал не найден');
  });

  it('shows why the project could not be created', async () => {
    post.mockImplementation((url: string) =>
      url === '/accounts/preview' ? new Promise(() => {}) : Promise.reject({ response: { data: { message: 'Название проекта слишком длинное' } } }));
    renderModal();
    fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать проект' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Название проекта слишком длинное');
  });
});
