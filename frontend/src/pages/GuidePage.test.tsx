import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { GuidePage } from './GuidePage';

describe('GuidePage', () => {
  it('walks through the service section by section', () => {
    render(<MemoryRouter><GuidePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Как пользоваться' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Что такое проект',
      'Как добавить проект',
      'Страница проекта',
      'Страница соцсети',
      'Instagram: публичные данные и полный доступ',
      'Обновление данных',
      'ВКонтакте и YouTube',
    ]);
    expect(screen.getByText('Видеоинструкция появится позже.')).toBeInTheDocument();
  });
});
