# Data Model

This is the initial backend-neutral data model for The Masonry Archive.

## User profile

```ts
type UserProfile = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: 'Student' | 'PhD candidate' | 'Researcher' | 'Professional';
  university?: string;
  country?: string;
  orcid?: string;
  laboratory?: string;
  createdAt: string;
  status: 'active' | 'suspended';
};
```

## Masonry image record

```ts
type MasonryImageRecord = {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  imageUrl: string;
  thumbnailUrl: string;
  originalImageUrl?: string;
  latitude: number;
  longitude: number;
  placeName?: string;
  country?: string;
  shotDate?: string;
  uploadDate: string;
  period?: string;
  constructionEra?: string;
  technique?: string;
  element?: 'Arch' | 'Vault' | 'Wall' | 'Pier' | 'Column' | 'Foundation' | 'Other';
  material?: string;
  texture?: string;
  tags: string[];
  license: 'CC BY 4.0' | 'CC0';
  authorProfileId: string;
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  reviewNotes?: string;
  approvedAt?: string;
  approvedBy?: string;
  alotiaJsonUrl?: string;
  deletionStatus?: 'none' | 'requested' | 'approved';
};
```

## Moderation event

```ts
type ModerationEvent = {
  id: string;
  recordId: string;
  actorProfileId: string;
  action:
    | 'submitted'
    | 'approved'
    | 'rejected'
    | 'changes_requested'
    | 'edit_submitted'
    | 'deletion_requested'
    | 'deletion_approved';
  notes?: string;
  createdAt: string;
};
```

## aLoTiA bridge

For records tagged as `arch`, the interface can suggest an aLoTiA workflow. The archive should store the JSON as a linked object, not as an opaque text field inside the main record.

```ts
type AlotiaAttachment = {
  id: string;
  recordId: string;
  jsonUrl: string;
  schemaVersion?: string;
  createdAt: string;
  createdBy: string;
};
```
