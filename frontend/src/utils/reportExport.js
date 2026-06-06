/**
 * Report export utilities for CSV and JSON generation.
 * Extracted from ProjectReport to keep components under the line limit.
 */

// CSV injection protection and value escaping
function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  let stringValue = value.toString().trim();

  // CSV injection protection: prevent formula execution in spreadsheet applications
  if (stringValue.match(/^[=@+\t-]/) || stringValue.toLowerCase().startsWith('cmd|') || stringValue.toLowerCase().startsWith('dde|')) {
    stringValue = `'${stringValue}`;
  }

  if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('\r') || stringValue.includes('\t')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  if (stringValue.match(/^[=@+-]/)) {
    return `"${stringValue}"`;
  }

  return stringValue;
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export function generateCSVReport({
  images, classes, project, annotationsByImage, getAnnotationSummary
}) {
  const headers = [
    'Image ID', 'Filename', 'Size (bytes)', 'Content Type',
    'Upload Date', 'Deleted', 'Comments Count', 'Comments',
    'Classifications', 'Custom Metadata', 'Annotation Count', 'Annotations'
  ];

  const rows = images.map(image => {
    const comments = image.comments?.map(c =>
      `${c.text} (by ${c.author?.email || 'Unknown'} on ${new Date(c.created_at).toLocaleString()})`
    ).join('; ') || '';
    const classifications = image.classifications?.map(c =>
      classes.find(cls => cls.id === c.class_id)?.name || 'Unknown'
    ).join(', ') || '';
    const customMetadata = image.metadata ? JSON.stringify(image.metadata) : '';
    const imgAnnotations = annotationsByImage[image.id] || [];
    const annotationSummary = getAnnotationSummary(image.id);

    return [
      escapeCsvValue(image.id),
      escapeCsvValue(image.filename || ''),
      escapeCsvValue(image.size_bytes || 0),
      escapeCsvValue(image.content_type || ''),
      escapeCsvValue(new Date(image.created_at).toLocaleString()),
      escapeCsvValue(image.deleted_at ? 'Yes' : 'No'),
      escapeCsvValue(image.comments?.length || 0),
      escapeCsvValue(comments),
      escapeCsvValue(classifications),
      escapeCsvValue(customMetadata),
      escapeCsvValue(imgAnnotations.length),
      escapeCsvValue(annotationSummary)
    ];
  });

  const csvContent = [headers.map(escapeCsvValue), ...rows].map(row => row.join(',')).join('\n');
  downloadBlob(new Blob([csvContent], { type: 'text/csv' }), `${project.name}_report.csv`);
}

export function generateJSONReport({
  images, classes, bboxClasses, bboxClassMap,
  project, currentUser, annotationsByImage
}) {
  const reportData = {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      meta_group_id: project.meta_group_id,
      created_at: project.created_at
    },
    classes,
    bbox_classes: bboxClasses,
    images: images.map(image => ({
      id: image.id,
      filename: image.filename,
      size_bytes: image.size_bytes,
      content_type: image.content_type,
      created_at: image.created_at,
      deleted_at: image.deleted_at,
      metadata: image.metadata || {},
      comments: image.comments || [],
      classifications: image.classifications || [],
      annotations: (annotationsByImage[image.id] || []).map(ann => ({
        id: ann.id,
        bbox_class_id: ann.bbox_class_id,
        class_name: bboxClassMap[ann.bbox_class_id]?.name || 'Unknown',
        class_color: bboxClassMap[ann.bbox_class_id]?.color || '#FF9800',
        bbox_x_min: ann.bbox_x_min,
        bbox_y_min: ann.bbox_y_min,
        bbox_x_max: ann.bbox_x_max,
        bbox_y_max: ann.bbox_y_max,
        image_width: ann.image_width,
        image_height: ann.image_height,
        notes: ann.notes,
      }))
    })),
    generated_at: new Date().toISOString(),
    generated_by: currentUser?.email || 'Unknown'
  };

  const jsonContent = JSON.stringify(reportData, null, 2);
  downloadBlob(new Blob([jsonContent], { type: 'application/json' }), `${project.name}_report.json`);
}
