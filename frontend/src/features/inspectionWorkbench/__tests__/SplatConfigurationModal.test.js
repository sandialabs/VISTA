import { fireEvent, render, screen } from '@testing-library/react';
import { SplatConfigurationModal } from '../SplatConfigurationModal';

const splatParameters = {
  threshold: 10,
  downsample: 2,
  maxSplats: 60000,
  outputFormat: 'ply',
  opacityMin: 0.1,
  opacityMax: 0.9,
};

const renderModal = (overrides = {}) => {
  const props = {
    splatConfigModalOpen: true,
    selectedPart: { id: 'part-1' },
    displayValueDomain: null,
    splatParameters,
    setSplatParameterOverridesByPart: jest.fn(),
    setSplatConfigModalOpen: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<SplatConfigurationModal {...props} />) };
};

describe('SplatConfigurationModal', () => {
  test('renders nothing when closed or without a selected part', () => {
    const { container, rerender, props } = renderModal({ splatConfigModalOpen: false });
    expect(container).toBeEmptyDOMElement();
    rerender(<SplatConfigurationModal {...props} splatConfigModalOpen selectedPart={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('writes per-part overrides, resets defaults, and closes', () => {
    const { props } = renderModal();
    expect(screen.getByRole('dialog', { name: 'Simplified 3DGS configuration' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Intensity threshold'), { target: { value: '25' } });
    const applyOverride = props.setSplatParameterOverridesByPart.mock.calls[0][0];
    expect(applyOverride({ other: { threshold: 1 } })).toEqual({
      other: { threshold: 1 },
      'part-1': { threshold: 25 },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset intelligent defaults' }));
    const reset = props.setSplatParameterOverridesByPart.mock.calls[1][0];
    expect(reset({ other: { threshold: 1 }, 'part-1': { threshold: 25 } })).toEqual({ other: { threshold: 1 } });

    fireEvent.click(screen.getByRole('button', { name: 'Close splat configuration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply splat parameters' }));
    expect(props.setSplatConfigModalOpen).toHaveBeenNthCalledWith(1, false);
    expect(props.setSplatConfigModalOpen).toHaveBeenNthCalledWith(2, false);
  });
});
